/**
 * Photo reminders, GPS-free photo uploads, and deletion on the push worker.
 *
 * The worker's URL comes from NEXT_PUBLIC_PUSH_API_URL (e.g. in .env.local).
 * While the tab holds a TRACE_B memory credential, the photo reminder goes
 * through TRACE_B instead (trace-api/reminder.ts).
 */

import { CONSENT_VERSION } from "./consent";
import type { LogEntry } from "./store";

export const PUSH_API_URL = (process.env.NEXT_PUBLIC_PUSH_API_URL ?? "").replace(/\/$/, "");

const DEVICE_KEY = "trace-device-id";
const EXPIRES_KEY = "trace-push-expires";
const PLAN_KEY = "trace-push-plan";

/** Older accuracy subscriptions remain readable so they can be stopped. */
export type PushPlan = { purpose: "photo" | "accuracy"; intervalMinutes: number };

export const REMINDER_PLAN: PushPlan = { purpose: "photo", intervalMinutes: 30 };

/** A random id per browser, so the worker can tell one phone's records from another's. Not tied to the hardware. */
export function deviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const created = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    return "unknown";
  }
}

/** After withdrawing, a later return starts as a stranger rather than as the same id. */
function forgetDeviceId(): void {
  try {
    window.localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Nothing stored.
  }
}

/** When the worker stops pinging this phone (midnight JST of the day it subscribed). */
export function subscriptionExpiresAt(): string | null {
  try {
    return window.localStorage.getItem(EXPIRES_KEY);
  } catch {
    return null;
  }
}

function saveExpiresAt(value: string | null): void {
  try {
    if (value) window.localStorage.setItem(EXPIRES_KEY, value);
    else window.localStorage.removeItem(EXPIRES_KEY);
  } catch {
    // Private mode.
  }
}

/**
 * The plan this phone last subscribed with. With none stored, a subscription
 * the phone holds is TRACE_B's photo reminder (trace-api/reminder.ts), which
 * keeps no plan here. Accuracy pings made before plans were stored (until
 * 2026-10-11) ended at midnight of their day, and the expiry check lets them go.
 */
export function subscriptionPlan(): PushPlan {
  try {
    const stored = JSON.parse(window.localStorage.getItem(PLAN_KEY) ?? "null") as PushPlan | null;
    if ((stored?.purpose === "photo" || stored?.purpose === "accuracy") && typeof stored.intervalMinutes === "number") return stored;
  } catch {
    // Unreadable: fall through.
  }
  // Read as the accuracy ping, TRACE_B's reminder would be stopped on every visit.
  return REMINDER_PLAN;
}

function savePlan(plan: PushPlan | null): void {
  try {
    if (plan) window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
    else window.localStorage.removeItem(PLAN_KEY);
  } catch {
    // Private mode.
  }
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Whether the browser made this subscription with the given VAPID public key:
 * the push worker's and TRACE_B's differ. Null where the browser does not say.
 */
export function madeWith(subscription: PushSubscription, publicKey: string): boolean | null {
  const own = subscription.options?.applicationServerKey;
  if (!own) return null;
  const mine = new Uint8Array(own);
  const theirs = base64UrlToBytes(publicKey);
  return mine.length === theirs.length && mine.every((byte, index) => byte === theirs[index]);
}

/** A fetch to the worker that never shows the browser's own words ("Load failed", "Failed to fetch") when the worker cannot be reached. */
async function reach(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${PUSH_API_URL}${path}`, init);
  } catch {
    throw new Error("通知サーバーにつながりませんでした。電波の良い場所で、もう一度試してください。");
  }
}

async function post(path: string, body: unknown): Promise<Response> {
  const response = await reach(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`通知サーバーへの送信に失敗しました（${response.status}）。`);
  return response;
}

/**
 * The page's service worker. ready never settles when it was never
 * registered (offline on the first visit, or blocked), which would leave the
 * reminder's switch and the menu's buttons waiting until a reload.
 */
export function serviceWorkerReady(ms = 10_000): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => {
      window.setTimeout(() => reject(new Error("通知の準備ができていません。ページを読み込み直してから、もう一度試してください。")), ms);
    }),
  ]);
}

/** Only participant photo reminders can create or update a subscription. */
export async function subscribe(registration: ServiceWorkerRegistration, consentVersion: string): Promise<PushSubscription> {
  const response = await reach("/vapid-public-key");
  if (!response.ok) throw new Error("通知サーバーに接続できませんでした。");
  const { publicKey } = (await response.json()) as { publicKey: string };
  // The browser holds one subscription and refuses a second key; one made for TRACE_B's reminder is let go here (TRACE_B drops it at its next send).
  const existing = await registration.pushManager.getSubscription();
  if (existing && madeWith(existing, publicKey) === false) await existing.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
  const body = { subscription: subscription.toJSON(), deviceId: deviceId(), consentVersion, purpose: REMINDER_PLAN.purpose, intervalMinutes: REMINDER_PLAN.intervalMinutes };
  const { expiresAt } = (await (await post("/subscribe", body)).json()) as { expiresAt: string };
  saveExpiresAt(expiresAt);
  savePlan(REMINDER_PLAN);
  return subscription;
}

export async function unsubscribe(subscription: PushSubscription): Promise<void> {
  // Forget it on the server first: a phone that unsubscribed locally but not there would keep being pinged into the void.
  await post("/unsubscribe", { endpoint: subscription.endpoint });
  if (!(await subscription.unsubscribe())) throw new Error("端末の通知購読を停止できませんでした。");
  saveExpiresAt(null);
  savePlan(null);
}

/** Remove an expired or legacy subscription locally; keep its plan when removal fails so a later visit can retry. */
export async function dropExpired(subscription: PushSubscription): Promise<void> {
  if (!(await subscription.unsubscribe())) throw new Error("端末の通知購読を停止できませんでした。");
  saveExpiresAt(null);
  savePlan(null);
}

export async function sendTestPing(subscription: PushSubscription): Promise<void> {
  await post("/test", { endpoint: subscription.endpoint });
}

/** Only the GPS-free checkpoint photo format can leave this device. Keep older entries unchanged for withdrawal. */
export function isUploadablePhoto(entry: LogEntry): boolean {
  const { record } = entry;
  return record.schema === 3 &&
    record.purpose === "photo-memory" &&
    record.consentVersion === CONSENT_VERSION &&
    record.place != null &&
    record.capture?.fixes?.length === 0 &&
    record.capture.coarse == null &&
    record.truth == null &&
    record.sourceGuess == null &&
    record.photo != null && record.photo.exif === null &&
    record.device?.geolocationPermission == null &&
    entry.photo instanceof Blob;
}

export async function uploadEntry(entry: LogEntry): Promise<void> {
  if (!isUploadablePhoto(entry)) throw new Error("位置情報を含む旧記録は送信しません。");
  const form = new FormData();
  form.set("record", JSON.stringify(entry.record));
  if (entry.photo) form.set("photo", new File([entry.photo], `${entry.id}.jpg`, { type: "image/jpeg" }));
  const response = await reach("/records", { method: "POST", body: form });
  if (!response.ok) throw new Error(`送信に失敗しました（${response.status}）。`);
}

/** Deletes everything this phone sent, on the worker, and starts a fresh anonymous id. */
export async function forgetMe(): Promise<number> {
  const id = deviceId();
  let deleted = 0;
  if (id !== "unknown") {
    const response = await post("/forget", { deviceId: id });
    deleted = ((await response.json()) as { deletedRecords: number }).deletedRecords;
  }
  forgetDeviceId();
  saveExpiresAt(null);
  savePlan(null);
  return deleted;
}
