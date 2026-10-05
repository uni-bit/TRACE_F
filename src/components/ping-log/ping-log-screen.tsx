"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are local blob: URLs */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { withBasePath } from "@/lib/base-path";
import { clearEntries, listEntries, putEntry, type PingEntry, type PingLocation } from "@/lib/ping-log/store";

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const SCHEDULE_KEY = "trace-ping-schedule";
const MAX_PHOTO_EDGE = 1280;

/**
 * The timer's whole state. `nextAt` is a wall-clock time rather than a
 * countdown so that a page the phone suspended still knows, when it wakes,
 * that a ring is overdue.
 */
type Schedule = {
  intervalMs: number;
  nextAt: number;
  /** The ring that is waiting for a photo, if any. */
  pendingAt: number | null;
};

/** `?every=30` rings every 30 seconds, for trying the loop without waiting ten minutes. */
function intervalFromQuery(): number {
  const seconds = Number(new URLSearchParams(window.location.search).get("every"));
  return Number.isFinite(seconds) && seconds >= 5 ? seconds * 1000 : DEFAULT_INTERVAL_MS;
}

function loadSchedule(): Schedule | null {
  try {
    const raw = window.localStorage.getItem(SCHEDULE_KEY);
    return raw ? (JSON.parse(raw) as Schedule) : null;
  } catch {
    return null;
  }
}

function saveSchedule(schedule: Schedule | null): void {
  try {
    if (schedule) window.localStorage.setItem(SCHEDULE_KEY, JSON.stringify(schedule));
    else window.localStorage.removeItem(SCHEDULE_KEY);
  } catch {
    // Private mode: the timer still runs for as long as the page stays open.
  }
}

function locate(): Promise<PingLocation> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("この端末では位置情報を使えません。"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }),
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED ? "位置情報が許可されていません。" : "位置情報を取得できませんでした。")),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  });
}

/** Phone photos are several MB; keep a JPEG small enough to send over a campus connection. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, MAX_PHOTO_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("写真を変換できませんでした。"))), "image/jpeg", 0.8));
}

function beep(audio: AudioContext | null): void {
  if (!audio) return;
  void audio.resume();
  for (const offset of [0, 0.25]) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, audio.currentTime + offset);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + offset + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(audio.currentTime + offset);
    oscillator.stop(audio.currentTime + offset + 0.2);
  }
}

function notificationState(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function PingLogScreen() {
  const [intervalMs] = useState(intervalFromQuery);
  const [schedule, setSchedule] = useState<Schedule | null>(loadSchedule);
  const scheduleRef = useRef<Schedule | null>(schedule);
  const [now, setNow] = useState(() => Date.now());
  const [entries, setEntries] = useState<PingEntry[]>([]);
  const [permission, setPermission] = useState(notificationState);
  const [wakeLock, setWakeLock] = useState<WakeLockSentinel | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The ref is the source of truth so a ring is decided exactly once, outside any state updater.
  const commit = useCallback((next: Schedule | null) => {
    scheduleRef.current = next;
    saveSchedule(next);
    setSchedule(next);
  }, []);

  const refresh = useCallback(async () => {
    try {
      setEntries(await listEntries());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "記録を読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    listEntries().then(setEntries, () => setMessage("記録を読み込めませんでした。"));
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register(withBasePath("/ping-sw.js"), { scope: withBasePath("/") })
        .then((registration) => { registrationRef.current = registration; })
        .catch(() => { registrationRef.current = null; });
    }
  }, []);

  const thumbs = useMemo<Record<string, string>>(() => Object.fromEntries(entries.map((entry) => [entry.id, URL.createObjectURL(entry.photo)])), [entries]);
  useEffect(() => () => Object.values(thumbs).forEach((url) => URL.revokeObjectURL(url)), [thumbs]);

  const ring = useCallback(async () => {
    navigator.vibrate?.([300, 150, 300]);
    beep(audioRef.current);
    if (notificationState() !== "granted") return;
    // `renotify` and `vibrate` are real options that the DOM typings leave out.
    const options = { body: "写真を1枚撮ってください。", tag: "trace-ping", renotify: true, requireInteraction: true, vibrate: [300, 150, 300], data: { url: "log" } } as NotificationOptions;
    try {
      if (registrationRef.current) await registrationRef.current.showNotification("TRACE", options);
      else new Notification("TRACE", options);
    } catch {
      // The in-page sound and vibration have already fired.
    }
  }, []);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      const active = scheduleRef.current;
      if (!active || current < active.nextAt) return;
      // Missed rings while the phone slept collapse into one; the next one stays on the grid.
      const skipped = Math.floor((current - active.nextAt) / active.intervalMs) + 1;
      commit({ ...active, pendingAt: active.nextAt, nextAt: active.nextAt + skipped * active.intervalMs });
      void ring();
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [commit, ring]);

  // The OS drops a wake lock whenever the page is hidden; take it back on return.
  useEffect(() => {
    if (!wakeLock) return;
    const reacquire = async () => {
      if (document.visibilityState === "visible" && wakeLock.released) setWakeLock(await navigator.wakeLock.request("screen").catch(() => null));
    };
    document.addEventListener("visibilitychange", reacquire);
    return () => document.removeEventListener("visibilitychange", reacquire);
  }, [wakeLock]);

  const start = async () => {
    if (typeof Notification !== "undefined" && Notification.permission === "default") setPermission(await Notification.requestPermission());
    audioRef.current ??= new AudioContext();
    void audioRef.current.resume();
    // Ask for location now, while the person is looking, rather than at the first photo.
    void locate().catch(() => undefined);
    commit({ intervalMs, nextAt: Date.now() + intervalMs, pendingAt: scheduleRef.current?.pendingAt ?? null });
    setMessage("");
  };

  const stop = () => commit(null);

  const toggleWakeLock = async () => {
    if (wakeLock && !wakeLock.released) {
      await wakeLock.release();
      setWakeLock(null);
      return;
    }
    try {
      setWakeLock(await navigator.wakeLock.request("screen"));
    } catch {
      setMessage("この端末では画面の点灯を維持できません。");
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    const position = locate().then((location) => ({ location, locationError: null }), (error: Error) => ({ location: null, locationError: error.message }));
    try {
      const photo = await shrink(file);
      const { location, locationError } = await position;
      const pendingAt = scheduleRef.current?.pendingAt ?? null;
      await putEntry({ id: crypto.randomUUID(), promptedAt: pendingAt ? new Date(pendingAt).toISOString() : null, takenAt: new Date().toISOString(), location, locationError, photo, sentAt: null });
      if (scheduleRef.current) commit({ ...scheduleRef.current, pendingAt: null });
      setMessage(locationError ? `写真を保存しました。${locationError}` : "写真と位置を保存しました。");
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存できませんでした。");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAll = async () => {
    if (!window.confirm("この端末の記録をすべて削除します。")) return;
    await clearEntries();
    await refresh();
  };

  const wakeLockSupported = "wakeLock" in navigator;
  const intervalLabel = intervalMs % 60000 === 0 ? `${intervalMs / 60000}分` : `${intervalMs / 1000}秒`;

  return (
    <main className="ping">
      <header className="ping-header">
        <p className="ping-eyebrow">TRACE / PROTOTYPE</p>
        <h1>定期ログ</h1>
        <p className="ping-muted">{intervalLabel}ごとに通知が鳴ります。鳴ったら写真を1枚撮ると、その場所と一緒に記録されます。</p>
      </header>

      {schedule?.pendingAt != null && (
        <section className="ping-card ping-due" aria-live="assertive">
          <strong>撮影の時間です</strong>
          <p>{clock(schedule.pendingAt)} の通知</p>
          <label htmlFor="ping-camera" className="ping-button ping-primary">{busy ? "保存中…" : "写真を撮る"}</label>
        </section>
      )}

      <section className="ping-card">
        {schedule ? (
          <>
            <span className="ping-eyebrow">次の通知まで</span>
            <strong className="ping-countdown">{countdown(schedule.nextAt - now)}</strong>
            <p className="ping-muted">{clock(schedule.nextAt)} に鳴ります</p>
            <button type="button" className="ping-button ping-quiet" onClick={stop}>停止</button>
          </>
        ) : (
          <>
            <span className="ping-eyebrow">停止中</span>
            <button type="button" className="ping-button ping-primary" onClick={() => void start()}>{intervalLabel}ごとの通知を開始</button>
          </>
        )}
        <div className="ping-row">
          <label htmlFor="ping-camera" className="ping-button ping-secondary">{busy ? "保存中…" : "今すぐ撮る"}</label>
          {wakeLockSupported && (
            <button type="button" className="ping-button ping-secondary" aria-pressed={!!wakeLock && !wakeLock.released} onClick={() => void toggleWakeLock()}>
              {wakeLock && !wakeLock.released ? "画面点灯: ON" : "画面点灯: OFF"}
            </button>
          )}
        </div>
        <input ref={inputRef} id="ping-camera" className="ping-file" type="file" accept="image/*" capture="environment" disabled={busy} onChange={(event) => void onPhoto(event.target.files?.[0])} />
        <p className="ping-muted ping-small">
          通知: {permission === "granted" ? "許可済み" : permission === "denied" ? "拒否されています（端末の設定から許可）" : permission === "unsupported" ? "このブラウザでは使えません（iPhone はホーム画面に追加して開く）" : "未確認"}
        </p>
      </section>

      {message && <p className="ping-message" role="status">{message}</p>}

      <section>
        <div className="ping-list-head">
          <h2>記録 {entries.length} 件</h2>
          {entries.length > 0 && <button type="button" className="ping-link" onClick={() => void removeAll()}>すべて削除</button>}
        </div>
        {entries.length === 0 ? (
          <p className="ping-muted">まだ記録はありません。</p>
        ) : (
          <ul className="ping-list">
            {entries.map((entry) => (
              <li key={entry.id} className="ping-entry">
                {thumbs[entry.id] && <img src={thumbs[entry.id]} alt="" />}
                <div>
                  <strong>{new Date(entry.takenAt).toLocaleTimeString("ja-JP")}</strong>
                  <span className="ping-muted ping-small">{entry.promptedAt ? `${clock(Date.parse(entry.promptedAt))} の通知` : "手動"} ・ 端末に保存（送信先は未接続）</span>
                  {entry.location ? (
                    <a className="ping-small" href={`https://www.google.com/maps?q=${entry.location.latitude},${entry.location.longitude}`} target="_blank" rel="noreferrer">
                      {entry.location.latitude.toFixed(5)}, {entry.location.longitude.toFixed(5)}（±{Math.round(entry.location.accuracy)}m）
                    </a>
                  ) : (
                    <span className="ping-small ping-warn">{entry.locationError ?? "位置なし"}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
