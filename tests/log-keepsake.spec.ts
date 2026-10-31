import { expect, test, type BrowserContext, type Download, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomBytes } from "node:crypto";

import { arrivalQrUrl } from "../src/lib/trace-api/arrival-code";

/**
 * /log after arriving at ShibaLab (#14): the keepsake drawn from the photos
 * kept on the phone, each photo saved or deleted (#51) on its own, and
 * 振り返り3D (#50) above it on the same screen; and what of each photo goes to TRACE_B
 * on the way there (#13). Like log-tabs.spec.ts, a stand-in answers for
 * TRACE_B at the standard same-origin /api/backend path. Chrome on a computer saves
 * by downloading, which is what is checked here; an iPhone's share sheet is not.
 */

const PHOTO = path.join(__dirname, "..", "models", "renders", "01_全体_南東の空から.jpg");
const HOUR = 60 * 60 * 1000;
const SHOTS = process.env.TRACE_TEST_SHOTS;

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, geolocation: undefined, permissions: [], acceptDownloads: true });

type Moment = { photoMomentId: string; clientPhotoId: string; checkpointId: string; capturedAt: string };

type StandIn = {
  /** Where the arrival's replay stands, once there is one. */
  replay: "playing" | "completed" | null;
  /** Explicit stop is terminal but preserves owner reads and deletion. */
  ended: boolean;
  expiresAt: string;
  joins: number;
  arrivals: Array<{ checkpointToken: string; clientTime: string; key: string }>;
  arrivalError: string | null;
  /** The photos' records TRACE_B keeps (#13), by the id the phone keeps each photo by. */
  moments: Map<string, Moment>;
  /** Every body sent to TRACE_B's /v2 photos, as it came. */
  sent: unknown[];
  /** Owner metadata reads used to recover lost create acknowledgements. */
  listed: number;
  /** TRACE_B's /v2 cannot be reached. */
  down: boolean;
  /** TRACE_B keeps a photo's record, but its answer is lost on the way back. */
  lose: boolean;
};

/** Answers TRACE_B's participant routes, including retained ownership after stopping. */
async function standIn(context: BrowserContext): Promise<StandIn> {
  const state: StandIn = { replay: null, ended: false, expiresAt: new Date(Date.now() + 6 * HOUR).toISOString(), joins: 0, arrivals: [], arrivalError: null, moments: new Map(), sent: [], listed: 0, down: false, lose: false };
  const memorySession = { sessionId: "mem-1", status: "main", expiresAt: state.expiresAt, deleteAfter: new Date(Date.now() + 30 * HOUR).toISOString() };
  await context.route("**/api/backend/v1/**", async (route) => {
    const request = route.request();
    const where = `${request.method()} ${new URL(request.url()).pathname.replace("/api/backend", "")}`;
    if (where === "GET /v1/public/config") {
      return route.fulfill({ json: {
        registrationOpen: true, consent: { version: "consent-1", language: "ja", body: "写真は端末に保存し、選択した場所と撮影時刻のみをサーバーに記録します。テスト用の参加説明です。" }, livePresenceConsentVersion: "live-1",
        photo: { enabled: true, maxCount: 12, maxUploadBytes: 3_000_000, maxLongEdgePixels: 1600, publicDisplay: false }, contact: "",
      } });
    }
    if (where === "POST /v1/experiences") {
      state.joins += 1;
      return route.fulfill({ status: 201, json: { experienceId: "exp-1", memorySession: { ...memorySession, participantToken: "token-1" } } });
    }
    if (where === "DELETE /v1/memory-sessions/mem-1") return route.fulfill({ status: 204 });
    if (where === "POST /v1/memory-sessions/mem-1/arrival") {
      expect(request.headers().authorization).toBe("Bearer token-1");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      state.arrivals.push({ ...request.postDataJSON(), key: request.headers()["idempotency-key"] });
      if (state.arrivalError) return route.fulfill({ status: 400, json: { error: { code: state.arrivalError, requestId: "req-arrival" } } });
      state.replay = "playing";
      return route.fulfill({ json: { arrivalId: "arrival-1", status: state.replay } });
    }
    if (where === "POST /v1/memory-sessions/mem-1/stop") {
      expect(request.headers().authorization).toBe("Bearer token-1");
      expect(request.headers()["idempotency-key"]).toBeTruthy();
      expect(request.postData()).toBeNull();
      state.ended = true;
      return route.fulfill({ json: { status: "ended", stoppedAt: new Date().toISOString(), expiresAt: state.expiresAt, deleteAfter: memorySession.deleteAfter } });
    }
    if (where === "GET /v1/experiences/exp-1") {
      return route.fulfill({ json: {
        memorySession: { ...memorySession, expiresAt: state.expiresAt, status: state.ended ? "ended" : state.replay === null ? "main" : "arrived" }, photoSummary: { ready: 0, pending: 0, failed: 0, maxCount: 12 }, replayStatus: state.replay,
      } });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-1" } } });
  });
  await context.route("**/api/backend/v2/**", async (route) => {
    if (state.down) return route.abort("internetdisconnected");
    const request = route.request();
    const where = `${request.method()} ${new URL(request.url()).pathname.replace("/api/backend", "")}`;
    const keyed = !!request.headers()["idempotency-key"] && request.headers().authorization === "Bearer token-1";
    if (where === "GET /v2/memory-sessions/mem-1/photos" && request.headers().authorization === "Bearer token-1") {
      state.listed += 1;
      return route.fulfill({ json: { photos: [...state.moments.values()].map((moment, index) => ({ ...moment, sequenceNo: index + 1 })) } });
    }
    if (where === "POST /v2/memory-sessions/mem-1/photos" && keyed) {
      const body = request.postDataJSON() as Omit<Moment, "photoMomentId">;
      state.sent.push(body);
      if (state.ended) return route.fulfill({ status: 409, json: { error: { code: "STATE_CONFLICT", requestId: "req-ended" } } });
      const known = state.moments.get(body.clientPhotoId);
      const moment = known ?? { photoMomentId: `photo_${state.sent.length}`, ...body };
      state.moments.set(body.clientPhotoId, moment);
      if (state.lose) return route.abort("connectionreset");
      return route.fulfill({ status: known ? 200 : 201, json: { ...moment, sequenceNo: state.moments.size } });
    }
    const removing = /^DELETE \/v2\/memory-sessions\/mem-1\/photos\/(photo_\w+)$/.exec(where);
    const moment = [...state.moments.values()].find((item) => item.photoMomentId === removing?.[1]);
    if (moment && keyed) {
      state.moments.delete(moment.clientPhotoId);
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", requestId: "req-2" } } });
  });
  await context.route("**/push-stub/**", (route) => route.fulfill({ json: { ok: true } }));
  return state;
}

/** The screen scrolls inside the phone, so it is taken a phone's height at a time: name-1.png, name-2.png… */
async function shoot(page: Page, name: string) {
  if (!SHOTS) return;
  const screen = page.locator(".screen").last();
  const { height, view } = await screen.evaluate((element) => ({ height: element.scrollHeight, view: element.clientHeight }));
  for (let part = 0; part * view < height; part += 1) {
    await screen.evaluate((element, top) => element.scrollTo(0, top), part * view);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, `${name}-${part + 1}.png`) });
  }
}

async function join(page: Page) {
  await page.goto("/log");
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

/** Synthetic signed bytes for the UI contract; the stand-in, not the frontend, accepts or rejects the proof. */
function boothLink(origin: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    purpose: "arrival", keyId: "arrival-proof-v1", checkpointId: "arrival-booth", venue: "shibalab-301",
    issuedAt, expiresAt: issuedAt + 25, nonce: randomBytes(32).toString("base64url"),
  })).toString("base64url");
  const token = `${payload}.${createHmac("sha256", "test-proof-key").update(payload).digest("base64url")}`;
  return { token, url: arrivalQrUrl(token, origin) };
}

async function denyArrivalCamera(page: Page) {
  const deny = () => {
    let requests = 0;
    Object.defineProperty(window, "arrivalCameraRequests", { get: () => requests });
    navigator.mediaDevices.getUserMedia = async () => {
      requests += 1;
      throw new DOMException("Camera denied by UI contract fixture", "NotAllowedError");
    };
  };
  await page.addInitScript(deny);
  await page.evaluate(deny);
}

const cameraRequests = (page: Page) => page.evaluate(() => {
  const requests = Reflect.get(window, "arrivalCameraRequests");
  if (typeof requests !== "number") throw new Error("Camera instrumentation is missing");
  return requests;
});

test("a retained participant's booth URL sends once without opening a camera, then follows real replay status", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await denyArrivalCamera(page);
  const link = boothLink(new URL(page.url()).origin);
  const { promise: held, resolve: release } = Promise.withResolvers<void>();
  await page.route("**/api/backend/v1/memory-sessions/mem-1/arrival", async (route) => {
    await held;
    await route.fallback();
  });
  await page.goto(link.url);
  await expect(page.getByRole("status").filter({ hasText: "到着を送信しています" })).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain("arrival=");
  expect(await cameraRequests(page)).toBe(0);
  release();
  await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
  expect(backend.arrivals).toHaveLength(1);
  expect(backend.arrivals[0].checkpointToken).toBe(link.token);
  expect(await page.evaluate((token) => JSON.stringify(Object.entries(localStorage)).includes(token), link.token)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("trace-memory-actions"))).not.toContain("checkpointToken");
  backend.replay = "completed";
  await expect(page.getByRole("heading", { name: "再生が終わりました" })).toBeVisible({ timeout: 15000 });
  expect(await cameraRequests(page)).toBe(0);
  await page.getByRole("button", { name: "ホームへもどる", exact: true }).last().click();
  await page.getByRole("button", { name: "作品を見る", exact: true }).click();
  await expect(page.locator(".keep")).toBeVisible();
  expect(backend.arrivals).toHaveLength(1);
});

test("a booth URL arriving through hash navigation sends once without requesting a camera", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await denyArrivalCamera(page);
  const link = boothLink(new URL(page.url()).origin);
  await page.evaluate((url) => { window.location.hash = new URL(url).hash; }, link.url);
  await expect.poll(() => backend.arrivals.length).toBe(1);
  await expect(page.locator(".screen--relay")).toBeVisible();
  expect(backend.arrivals[0].checkpointToken).toBe(link.token);
  expect(new URL(page.url()).hash).not.toContain("arrival=");
  expect(await cameraRequests(page)).toBe(0);
  // The internal layer hash is navigation only, never another arrival request.
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  expect(backend.arrivals).toHaveLength(1);
});

test("an unjoined booth URL explains consent and never creates or sends a participation", async ({ context, page }) => {
  const backend = await standIn(context);
  await page.goto("/log");
  await denyArrivalCamera(page);
  const link = boothLink(new URL(page.url()).origin);
  await page.goto(link.url);
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  await expect(page.getByText(/このブラウザではまだ参加していません/)).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  expect(backend.joins).toBe(0);
  expect(backend.arrivals).toEqual([]);
  expect(await cameraRequests(page)).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("trace-memory-credential"))).toBeNull();
  await page.getByRole("button", { name: /はじめる/ }).click();
  await page.getByRole("button", { name: /次へ/ }).click();
  await page.getByRole("button", { name: "同意して参加する" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
  expect(backend.joins).toBe(1);
  expect(backend.arrivals).toEqual([]);
  await expect(page.getByText(/このブラウザではまだ参加していません/)).not.toBeVisible();
  const again = boothLink(new URL(page.url()).origin);
  await page.goto(again.url);
  await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
  expect(backend.joins).toBe(1);
  expect(backend.arrivals).toHaveLength(1);
  expect(backend.arrivals[0].checkpointToken).toBe(again.token);
});

for (const condition of ["ended", "expired"] as const) {
  test(`a ${condition} participant's booth URL retains ownership without sending arrival`, async ({ context, page }) => {
    const backend = await standIn(context);
    await join(page);
    const retained = await page.evaluate(() => localStorage.getItem("trace-memory-credential"));
    backend.ended = condition === "ended";
    if (condition === "expired") backend.expiresAt = new Date(Date.now() - 1000).toISOString();
    await page.evaluate(({ condition, expiresAt }) => {
      const memory = JSON.parse(localStorage.getItem("trace-memory-credential")!);
      const experience = JSON.parse(localStorage.getItem("trace-experience")!);
      if (condition === "ended") experience.status = "ended";
      else memory.expiresAt = expiresAt;
      localStorage.setItem("trace-memory-credential", JSON.stringify(memory));
      localStorage.setItem("trace-experience", JSON.stringify(experience));
    }, { condition, expiresAt: backend.expiresAt });
    const link = boothLink(new URL(page.url()).origin);
    await page.goto(link.url);
    await expect(page.getByText(/この参加は終了しているため、到着は送信していません/)).toBeVisible();
    expect(backend.arrivals).toEqual([]);
    expect(backend.joins).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("trace-memory-credential")!).participantToken)).toBe(JSON.parse(retained!).participantToken);
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.getByRole("button", { name: "参加をやめる", exact: true }).click();
    await page.getByRole("button", { name: "やめて削除する", exact: true }).click();
    await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  });
}

test("a rejected URL arrival shows the real failure without resending or requesting a camera", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await denyArrivalCamera(page);
  backend.arrivalError = "INVALID_ARRIVAL_PROOF";
  const link = boothLink(new URL(page.url()).origin);
  await page.goto(link.url);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(".scan__video")).toHaveCount(0);
  expect(await cameraRequests(page)).toBe(0);
  expect(backend.arrivals).toHaveLength(1);
  expect(await page.evaluate((token) => JSON.stringify(Object.entries(localStorage)).includes(token), link.token)).toBe(false);
  // Starting the in-app scanner is a separate, explicit action after a failed native URL.
  await page.getByRole("button", { name: "QR コードを読み取る", exact: true }).click();
  await expect.poll(() => cameraRequests(page)).toBe(1);
  expect(backend.arrivals).toHaveLength(1);
});

test("the internal camera rejects raw or foreign input and submits only a same-origin URL proof", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  const link = boothLink(new URL(page.url()).origin);
  await page.evaluate((text) => {
    Object.defineProperty(window, "arrivalScannerText", { value: text, writable: true, configurable: true });
    Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: class {
      static async getSupportedFormats() { return ["qr_code"]; }
      async detect() {
        const text = Reflect.get(window, "arrivalScannerText");
        if (typeof text !== "string") throw new Error("Scanner input is missing");
        return [{ rawValue: text,
          cornerPoints: [{ x: 80, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 240 }, { x: 80, y: 240 }] }];
      }
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      const context = canvas.getContext("2d")!;
      const draw = () => { context.fillStyle = "#fff"; context.fillRect(0, 0, 320, 320); };
      draw();
      const stream = canvas.captureStream(10);
      const timer = window.setInterval(draw, 100);
      stream.getVideoTracks()[0].addEventListener("ended", () => window.clearInterval(timer));
      return stream;
    };
  }, link.token);
  await page.getByRole("button", { name: "QR コードを読み取る" }).click();
  await expect(page.getByRole("alert")).toContainText("この参加先の到着用 URL ではありません");
  expect(backend.arrivals).toEqual([]);
  await page.evaluate((text) => { Reflect.set(window, "arrivalScannerText", text); }, arrivalQrUrl(link.token, "https://other-participation.example"));
  await expect(page.getByRole("alert")).toContainText("別の参加先");
  expect(backend.arrivals).toEqual([]);
  await page.evaluate((text) => { Reflect.set(window, "arrivalScannerText", text); }, link.url);
  await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
  expect(backend.arrivals).toHaveLength(1);
  expect(backend.arrivals[0].checkpointToken).toBe(link.token);
  expect(await page.evaluate((token) => JSON.stringify(Object.entries(localStorage)).includes(token), link.token)).toBe(false);
});

test("after a replay, home's QR code button reads the booth's code again for another replay, under a new key", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  // The camera sees whatever window.arrivalScannerText says.
  const scanner = () => {
    Object.defineProperty(globalThis, "BarcodeDetector", { configurable: true, value: class {
      static async getSupportedFormats() { return ["qr_code"]; }
      async detect() {
        const text = Reflect.get(window, "arrivalScannerText");
        return typeof text === "string"
          ? [{ rawValue: text, cornerPoints: [{ x: 80, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 240 }, { x: 80, y: 240 }] }]
          : [];
      }
    } });
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 320;
      const context = canvas.getContext("2d")!;
      const draw = () => { context.fillStyle = "#fff"; context.fillRect(0, 0, 320, 320); };
      draw();
      const stream = canvas.captureStream(10);
      const timer = window.setInterval(draw, 100);
      stream.getVideoTracks()[0].addEventListener("ended", () => window.clearInterval(timer));
      return stream;
    };
  };
  await page.addInitScript(scanner);
  const read = (url: string) => page.evaluate((text) => { Reflect.set(window, "arrivalScannerText", text); }, url);

  // TRACE_B played this participation's replay already: home leads to the keepsake, and to the QR code again.
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.locator(".keep")).toBeVisible();
  await page.getByRole("button", { name: "ホームへもどる", exact: true }).last().click();

  for (const visit of [1, 2]) {
    const link = boothLink(new URL(page.url()).origin);
    await read(link.url);
    await page.getByRole("button", { name: "QR コードを読み取る" }).click();
    await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
    expect(backend.arrivals).toHaveLength(visit);
    expect(backend.arrivals[visit - 1].checkpointToken).toBe(link.token);
    backend.replay = "completed";
    await expect(page.getByRole("heading", { name: "作品を保存できます" })).toBeVisible({ timeout: 15000 });
    await read("");
    await page.getByRole("button", { name: "ホームへもどる", exact: true }).last().click();
    await expect(page.getByRole("button", { name: "QR コードを読み取る" })).toBeVisible();
  }
  expect(backend.arrivals[0].key).not.toBe(backend.arrivals[1].key);
});

/** Takes a photo and saves it at a place picked from the list: building, floor, place. */
async function savePhoto(page: Page, number: number, [building, floor, place] = ["本部棟", "5F", "本部棟5F"]) {
  await page.locator('input[type="file"][capture]').setInputFiles(PHOTO);
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await page.getByRole("button", { name: "一覧で選ぶ" }).click();
  await page.getByRole("radio", { name: building, exact: true }).click();
  await page.getByRole("radio", { name: floor, exact: true }).click();
  await page.getByRole("radio", { name: place }).click();
  await page.getByRole("button", { name: "ここで保存" }).click();
  await expect(page.getByText(`${number}枚目の写真を残しました`)).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "写真を撮る" }).first()).toBeVisible();
}

/** How many photos this browser keeps in IndexedDB. */
const kept = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("entries", "readonly").objectStore("entries").count();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            open.result.close();
            resolve(request.result);
          };
        };
      }),
  );

/** TRACE_B's record id each kept photo carries, oldest first: "waiting" while it is still to be sent, null when it never will be. */
const momentIds = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<(string | null)[]>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const request = open.result.transaction("entries", "readonly").objectStore("entries").getAll();
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            open.result.close();
            const entries = request.result as { record: { takenAt: string }; photoMomentId?: string | null }[];
            resolve(entries.sort((a, b) => a.record.takenAt.localeCompare(b.record.takenAt)).map((entry) => (entry.photoMomentId === undefined ? "waiting" : entry.photoMomentId)));
          };
        };
      }),
  );

/** A downloaded JPEG: its name, its size in pixels, and whether it carries an EXIF block. */
async function jpeg(download: Download) {
  const bytes = await readFile(await download.path());
  expect([bytes[0], bytes[1]]).toEqual([0xff, 0xd8]);
  let width = 0;
  let height = 0;
  let exif = false;
  for (let at = 2; at + 9 < bytes.length && bytes[at] === 0xff; at += 2 + bytes.readUInt16BE(at + 2)) {
    const marker = bytes[at + 1];
    if (marker === 0xe1 && bytes.subarray(at + 4, at + 8).toString("latin1") === "Exif") exif = true;
    if (marker === 0xc0 || marker === 0xc2) {
      height = bytes.readUInt16BE(at + 5);
      width = bytes.readUInt16BE(at + 7);
      break;
    }
  }
  return { name: download.suggestedFilename(), width, height, exif };
}

test("after the replay, home leads to the keepsake, which saves as one picture without metadata; each photo saves too", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await savePhoto(page, 2);

  // Before arriving, a photo saves from home's strip.
  const [single] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "2枚目の写真を保存" }).click()]);
  const photo = await jpeg(single);
  expect(photo.name).toMatch(/^TRACE_\d{4}-\d{2}-\d{2}_\d{4}\.jpg$/);
  expect(photo.exif).toBe(false);

  // TRACE_B has the arrival: home leads on to the replay, which leads to the keepsake once it is over.
  backend.replay = "playing";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "スクリーンを見てください" })).toBeVisible();
  backend.replay = "completed";
  await expect(page.getByRole("heading", { name: "作品を保存できます" })).toBeVisible({ timeout: 15000 });
  await shoot(page, "replay-done");
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "ご来場ありがとうございました" })).toBeVisible();
  const art = page.getByRole("img", { name: /^作品。撮った2枚の写真/ });
  await expect(art).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await shoot(page, "keepsake");

  const [whole] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "作品を保存する" }).click()]);
  const keepsake = await jpeg(whole);
  expect(keepsake).toEqual({ name: expect.stringMatching(/^TRACE_\d{4}-\d{2}-\d{2}\.jpg$/), width: 1440, height: 2560, exif: false });

  // Each photo saves from the keepsake's own list too.
  const [again] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "1枚目の写真を保存" }).click()]);
  expect((await jpeg(again)).exif).toBe(false);
});

test("the TRACE mark leads to the title, which leads home without joining again; the developer button waits for ?dev", async ({ context, page }) => {
  const backend = await standIn(context);
  let joins = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/v1/experiences")) joins += 1;
  });
  await join(page);
  await savePhoto(page, 1);
  await expect(page.getByRole("button", { name: "開発者" })).toHaveCount(0);

  // From home: the title, whose foot leads back instead of to the consent.
  await page.getByRole("button", { name: "TRACE（タイトルへ）" }).click();
  await expect(page.getByRole("heading", { name: "撮った写真" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /はじめる/ })).toHaveCount(0);
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "1枚目の写真を保存" })).toBeVisible();

  // From the keepsake after arriving, the same.
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "ご来場ありがとうございました" })).toBeVisible();
  await page.getByRole("button", { name: "TRACE（タイトルへ）" }).click();
  await expect(page.getByRole("heading", { name: "ご来場ありがとうございました" })).toHaveCount(0);
  await page.getByRole("button", { name: "ホームへもどる" }).click();
  await expect(page.getByRole("button", { name: "作品を見る" })).toBeVisible();
  expect(joins).toBe(1);

  await page.goto("/log?dev");
  await expect(page.getByRole("button", { name: "開発者" })).toBeVisible();
});

test("a browser without the photos says the keepsake cannot be made here", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "ご来場ありがとうございました" })).toBeVisible();
  await expect(page.getByText(/この端末には写真が残っていないので/)).toBeVisible();
  await expect(page.getByRole("button", { name: "作品を保存する" })).toHaveCount(0);
  await shoot(page, "keepsake-empty");
});

test("a photo deletes after a question, from home before arriving and from the keepsake after; withdrawing leaves none on the phone", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  for (const number of [1, 2, 3]) await savePhoto(page, number);

  // Before arriving: from home's strip, after a question that can be cancelled.
  await page.getByRole("button", { name: "2枚目の写真を削除" }).click();
  await expect(page.getByRole("heading", { name: "2枚目の写真を削除しますか？" })).toBeVisible();
  await page.screenshot({ path: SHOTS ? path.join(SHOTS, "delete-ask.png") : undefined });
  await page.getByRole("button", { name: "キャンセル" }).click();
  await expect(page.getByText("3枚（12枚まで）")).toBeAttached();
  expect(await kept(page)).toBe(3);
  await page.getByRole("button", { name: "2枚目の写真を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("heading", { name: "2枚目の写真を削除しますか？" })).toHaveCount(0);
  await expect(page.getByText("2枚（12枚まで）")).toBeAttached();
  expect(await kept(page)).toBe(2);

  // After arriving: from the keepsake, which is drawn again without it.
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("img", { name: /^作品。撮った2枚の写真/ })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "1枚目の写真を削除" }).click();
  await expect(page.getByText("作品からも外れます。")).toBeVisible();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("img", { name: /^作品。撮った1枚の写真/ })).toBeVisible({ timeout: 15000 });
  expect(await kept(page)).toBe(1);

  // Withdrawing deletes the participation on TRACE_B and every photo here.
  await page.getByRole("button", { name: "ホームへもどる" }).last().click();
  await page.getByRole("button", { name: "メニュー" }).click();
  await page.getByRole("button", { name: "参加をやめる" }).click();
  await page.getByRole("button", { name: "やめて削除する" }).click();
  await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  // The title is up once TRACE_B has let go; the phone clears its photos just after.
  await expect.poll(() => kept(page)).toBe(0);
});

test("each photo's place and time go to TRACE_B, never the photo; a photo deletes there first, and stays while TRACE_B is out of reach", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await expect.poll(() => momentIds(page)).toEqual(["photo_1"]);

  // Out of reach, a photo still saves and waits on the phone; back online, it goes.
  backend.down = true;
  await savePhoto(page, 2, ["研究棟", "7F", "研究棟7F 運河側"]);
  await expect.poll(() => momentIds(page)).toEqual(["photo_1", "waiting"]);
  backend.down = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => momentIds(page)).toEqual(["photo_1", "photo_2"]);

  // Only the photo's id, its checkpoint and its time went, once each.
  expect(backend.sent).toHaveLength(2);
  for (const body of backend.sent) expect(Object.keys(body as object).sort()).toEqual(["capturedAt", "checkpointId", "clientPhotoId"]);
  const [first, second] = [...backend.moments.values()];
  expect(first.checkpointId).not.toBe(second.checkpointId);
  expect(Date.parse(first.capturedAt)).toBeLessThan(Date.parse(second.capturedAt));

  // Out of reach, deleting keeps the photo and says why; the question stays up to try again.
  backend.down = true;
  await page.getByRole("button", { name: "1枚目の写真を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "サーバーにつながりませんでした" })).toBeVisible();
  expect(await kept(page)).toBe(2);
  backend.down = false;
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("heading", { name: "1枚目の写真を削除しますか？" })).toHaveCount(0);
  expect(await kept(page)).toBe(1);
  expect([...backend.moments.values()].map((moment) => moment.photoMomentId)).toEqual(["photo_2"]);

  // A photo taken after the arrival goes to TRACE_B too, for the next replay.
  backend.replay = "completed";
  await page.reload();
  await expect(page.getByRole("button", { name: "作品を見る" })).toBeVisible();
  await savePhoto(page, 2, ["交流棟", "3F", "交流棟3F 食堂"]);
  await expect.poll(() => momentIds(page)).toEqual(["photo_2", "photo_3"]);
  expect(backend.sent).toHaveLength(3);

  // One an earlier version kept off TRACE_B after the arrival (null) goes once the page opens again.
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("trace-ping-log");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const store = open.result.transaction("entries", "readwrite").objectStore("entries");
          const request = store.getAll();
          request.onsuccess = () => {
            const entries = request.result as { record: { takenAt: string }; photoMomentId?: string | null }[];
            const last = entries.sort((a, b) => a.record.takenAt.localeCompare(b.record.takenAt)).at(-1)!;
            store.put({ ...last, photoMomentId: null }).onsuccess = () => {
              open.result.close();
              resolve();
            };
          };
        };
      }),
  );
  await page.reload();
  await expect.poll(() => momentIds(page)).toEqual(["photo_2", "photo_3"]);
  expect(backend.sent).toHaveLength(4);
});

test("a photo whose answer from TRACE_B was lost is found there by its id when deleted, and deleted there too", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  backend.lose = true;
  await savePhoto(page, 1);
  await expect.poll(() => backend.moments.size).toBe(1);
  expect(await momentIds(page)).toEqual(["waiting"]);
  backend.lose = false;
  await page.getByRole("button", { name: "1枚目の写真を削除" }).click();
  await page.getByRole("button", { name: "削除する" }).click();
  await expect(page.getByRole("heading", { name: "1枚目の写真を削除しますか？" })).toHaveCount(0);
  expect(await kept(page)).toBe(0);
  expect(backend.moments.size).toBe(0);
  expect(backend.listed).toBe(1);
  expect(backend.sent).toHaveLength(1);
});

for (const ending of ["stop", "expiry"] as const) {
  test(`${ending} prevents new metadata creates but retains owner recovery and deletion after a lost acknowledgement`, async ({ context, page }) => {
    if (ending === "expiry") await page.clock.install();
    const backend = await standIn(context);
    await join(page);
    backend.lose = true;
    await savePhoto(page, 1);
    await expect.poll(() => backend.moments.size).toBe(1);
    expect(await momentIds(page)).toEqual(["waiting"]);
    backend.lose = false;
    const creates = backend.sent.length;

    if (ending === "stop") {
      await page.getByRole("button", { name: "メニュー" }).click();
      await page.getByRole("button", { name: "記録を残して参加を終了", exact: true }).click();
      await page.getByRole("button", { name: "記録を残して終了する", exact: true }).click();
      await expect(page.getByRole("heading", { name: "記録を残して参加を終了しますか？" })).toHaveCount(0);
    } else {
      backend.ended = true;
      await page.clock.fastForward(6 * HOUR + 1000);
    }
    await expect(page.getByRole("button", { name: "写真を撮る", exact: true }).first()).toBeDisabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "写真を撮る", exact: true }).first()).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    expect(await momentIds(page)).toEqual(["waiting"]);

    // A GET finds the already-created record without replaying a now-forbidden POST.
    await page.getByRole("button", { name: "1枚目の写真を削除" }).click();
    await page.getByRole("button", { name: "削除する", exact: true }).click();
    await expect.poll(() => kept(page)).toBe(0);
    expect(backend.moments.size).toBe(0);
    expect(backend.listed).toBe(1);
    expect(backend.sent).toHaveLength(creates);
    await expect(page.getByRole("button", { name: /はじめる/ })).toHaveCount(0);

    // Stopping is not deletion: the retained owner can still withdraw the whole memory.
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.getByRole("button", { name: "参加をやめる", exact: true }).click();
    await page.getByRole("button", { name: "やめて削除する" }).click();
    await expect(page.getByRole("button", { name: /はじめる/ })).toBeVisible();
  });
}

/** Where the photos' pins stand over the 3D view. */
const pinsAt = (page: Page) => page.locator(".trace__pin:not([hidden])").evaluateAll((pins) => pins.map((pin) => (pin as HTMLElement).style.transform));

test("振り返り3D, above the keepsake, draws the way from the photos' places to ShibaLab, turns by dragging, and lists the places in order", async ({ context, page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await savePhoto(page, 2, ["研究棟", "7F", "研究棟7F 運河側"]);
  await savePhoto(page, 3, ["交流棟", "3F", "交流棟3F 食堂"]);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  // On the keepsake screen itself, before the picture.
  await expect(page.getByRole("heading", { name: "あなたの軌跡" })).toBeVisible();
  expect(await page.locator(".keep__trace").evaluate((trace) => !!(trace.compareDocumentPosition(document.querySelector(".keep__art")!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);

  // Each photo stands over the way, once the drawing code has loaded.
  await expect(page.locator(".trace__pin:not([hidden])")).toHaveCount(3, { timeout: 15000 });
  await expect(page.getByRole("status").filter({ hasText: "表示できないので" })).toHaveCount(0);
  const rows = page.locator(".trace__list li");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0)).toContainText("1枚目");
  await expect(rows.nth(0)).toContainText("本部棟5F");
  await expect(rows.nth(1)).toContainText("研究棟7F 運河側");
  await expect(rows.nth(2)).toContainText("交流棟3F 食堂");
  await expect(rows.nth(3)).toContainText("ShibaLab（教室棟301）");
  await page.waitForTimeout(500);
  await shoot(page, "trace");

  // Dragging turns the view, and the pins move with it; 元の向きにもどす puts it back.
  await page.locator(".trace__canvas").scrollIntoViewIfNeeded();
  const first = await pinsAt(page);
  const box = (await page.locator(".trace__canvas").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 8 });
  await page.mouse.up();
  expect(await pinsAt(page)).not.toEqual(first);
  await page.getByRole("button", { name: "元の向きにもどす" }).click();
  await expect.poll(() => pinsAt(page)).toEqual(first);

  // A place in the list brings up its photo.
  await rows.nth(1).getByRole("button").click();
  await expect(page.locator(".trace__pick")).toContainText("研究棟7F 運河側");
  await expect(rows.nth(1).getByRole("button")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: SHOTS ? path.join(SHOTS, "trace-pick.png") : undefined });
  expect(problems).toEqual([]);
});

test("one photo still draws the final photo-to-arrival route and exposes both stops", async ({ context, page }) => {
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  await expect(page.getByRole("button", { name: "QR コードを読み取る" })).toBeVisible();
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("heading", { name: "あなたの軌跡" })).toBeVisible();
  await expect(page.locator(".trace__pin:not([hidden])")).toHaveCount(1, { timeout: 15000 });
  await expect(page.getByRole("button", { name: "元の向きにもどす" })).toBeEnabled();
  const rows = page.locator(".trace__list li");
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("本部棟5F");
  await expect(rows.last()).toContainText("ShibaLab（教室棟301）");
});

test("without WebGL, 振り返り3D says so and still lists the places", async ({ context, page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, kind: string, ...rest: unknown[]) {
      return kind.includes("webgl") ? null : (getContext as (...args: unknown[]) => unknown).call(this, kind, ...rest);
    } as typeof getContext;
  });
  const backend = await standIn(context);
  await join(page);
  await savePhoto(page, 1);
  backend.replay = "completed";
  await page.reload();
  await page.getByRole("button", { name: "作品を見る" }).click();
  await expect(page.getByRole("status").filter({ hasText: "表示できないので" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".trace__canvas")).toHaveCount(0);
  await expect(page.locator(".trace__list li")).toHaveCount(2);
  await shoot(page, "trace-off");
});
