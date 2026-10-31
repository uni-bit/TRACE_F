"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { qrReader, type CodeReader, type DetectedCode } from "@/lib/ping-log/qr-reader";
import { readArrivalQrUrl } from "@/lib/trace-api/arrival-code";
import {
  TraceApiError,
  arrivalAttempt,
  getExperience,
  sendArrival,
  type ArrivalAttempt,
  type MemoryCredential,
  type ReplayStatus,
} from "@/lib/trace-api/client";
import type { LogEntry } from "@/lib/ping-log/store";
import { loadTabExperience, sendMemoryAction } from "@/lib/trace-api/session";

import { useLayer } from "../layer";
import { ScanWindow, placeTrackers } from "./demo";
import { KeepsakeScreen } from "./keepsake";
import { Relay, type RelayState } from "./relay";
import { Icon, Phrases, Screen, Sentences, SWAP, useField, useRay } from "./stage";

/**
 * Arriving at ShibaLab: the phone's rear camera reads the QR code in the
 * booth's projected picture, the arrival goes to TRACE_B, and the phone
 * follows the replay on the room's screen until it has played or been skipped.
 * Then the photos taken before arriving become the keepsake (keepsake.tsx),
 * shown under the way between their places, 振り返り3D (trace.tsx). Reading
 * the code again after the replay asks for another, with the photos since.
 *
 * As in the demo, the phone shows no queue, no wait and no symbol. The camera
 * picture never leaves the phone: only the code read from it is sent.
 */

export type ArrivalTarget = { experienceId: string; memory: MemoryCredential };

/** 15 a minute: half of TRACE_B's 30 per participant, which the arrival and the skip share. */
const POLL_MS = 4000;
const READ_EVERY_MS = 150;
/** After a failed try, the same code in view is not sent again before this. */
const RETRY_AFTER_MS = 2000;
/** The trackers leave a code that has not been seen for this long. */
const LOST_AFTER_MS = 600;

/** On `next dev` only, where the booth's QR code is seldom at hand: a button sends a made-up code as if it had been read. */
const PRETEND = process.env.NODE_ENV === "development";

const STATUSES: readonly string[] = ["queued", "playing", "completed", "skipped"];

function replayStatus(value: unknown): ReplayStatus | null {
  return typeof value === "string" && STATUSES.includes(value) ? (value as ReplayStatus) : null;
}

function isFinal(status: ReplayStatus | null): boolean {
  return status === "completed" || status === "skipped";
}

type ReadAnswer = { ok: true } | { ok: false; code: string; message: string; retryAfter: number | null };

/**
 * onArrived: TRACE_B has the arrival, now or from before; it ends the photo reminder then.
 * toKeepsake: opened from home after arriving, so a replay that is over leads straight to the keepsake.
 * again: opened from home's QR code button after arriving: the camera reads the booth's code for another replay.
 */
export function ArrivalFlow({
  target,
  incomingArrivalToken,
  photos,
  contact,
  toKeepsake,
  again,
  ended,
  inert,
  onClose,
  onTitle,
  beforeArrival,
  onArrived,
  onDelete,
}: {
  target: ArrivalTarget;
  incomingArrivalToken: string | null;
  /** This participation's photos, oldest first. */
  photos: LogEntry[];
  /** Where to ask about the data, shown with the keepsake. */
  contact: string;
  toKeepsake: boolean;
  again: boolean;
  ended: boolean;
  inert: boolean;
  onClose: () => void;
  /** The TRACE mark: this closes, and the title shows. */
  onTitle: () => void;
  /** Gives the photos' places still on their way a moment to reach TRACE_B (#13); never rejects. */
  beforeArrival: () => Promise<void>;
  onArrived: (memorySessionId: string) => void;
  /** Asks before deleting a photo (#51). */
  onDelete: (entry: LogEntry, number: number) => void;
}) {
  const { go } = useRay();
  const [step, setStep] = useState<"connecting" | "scan" | "replay" | "keepsake">(ended ? "keepsake" : incomingArrivalToken ? "connecting" : "scan");
  const [status, setStatus] = useState<ReplayStatus | null>(null);
  const [incomingFailure, setIncomingFailure] = useState<Extract<ReadAnswer, { ok: false }> | null>(null);
  // StrictMode's effect replay observes the same send instead of sending the proof twice.
  const incomingRead = useRef<Promise<ReadAnswer> | null>(null);
  const close = useLayer("#arrival", onClose);
  const leave = useCallback(() => void go(close), [go, close]);
  const title = useCallback(
    () =>
      void go(() => {
        close();
        onTitle();
      }),
    [go, close, onTitle],
  );
  const attempt = useRef<ArrivalAttempt | null>(null);
  // A code is on its way, or has arrived: the check below no longer moves the screen.
  const reading = useRef(false);
  const arrived = useRef(false);
  const endedRef = useRef(ended);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    endedRef.current = ended;
  }, [ended]);
  const { experienceId, memory } = target;
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onArrivedRef.current = onArrived;
  }, [onArrived]);
  const beforeArrivalRef = useRef(beforeArrival);
  useEffect(() => {
    beforeArrivalRef.current = beforeArrival;
  }, [beforeArrival]);

  // The places still on their way start for TRACE_B while the camera starts, so reading the code seldom waits for them.
  useEffect(() => {
    if (!ended) void beforeArrivalRef.current();
  }, [ended]);

  // Arrived already (a reload, or the button pressed again): straight to where the replay stands.
  // Not when the camera was opened for another replay: the code it reads asks TRACE_B for one.
  useEffect(() => {
    let alive = true;
    if (ended || again) return;
    getExperience(experienceId, memory)
      .then((state) => {
        const known = replayStatus(state.replayStatus);
        if (!alive || !known || reading.current || arrived.current) return;
        onArrivedRef.current(memory.memorySessionId);
        void go(() => {
          setStatus(known);
          setStep(toKeepsake && isFinal(known) ? "keepsake" : "replay");
        });
      })
      // The camera is starting anyway; sending the code will tell.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [go, experienceId, memory, toKeepsake, again, ended]);

  const read = useCallback(
    async (code: string): Promise<ReadAnswer> => {
      reading.current = true;
      // Retry the same request with its stable key; every reply reflects the current replay state.
      if (attempt.current?.checkpointToken !== code) attempt.current = arrivalAttempt(code);
      const current = attempt.current;
      try {
        // The room's screen draws the way from the places TRACE_B has when the arrival comes.
        await beforeArrivalRef.current();
        // sendMemoryAction persists its input for idempotency; retain only a fingerprint, never the booth proof.
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(current)));
        const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const result = await sendMemoryAction(memory.memorySessionId, "arrival", fingerprint, (key) => {
          const stored = loadTabExperience();
          if (!active.current || endedRef.current || Date.parse(memory.expiresAt) <= Date.now() ||
            (stored && (stored.status === "ended" || stored.memory.memorySessionId !== memory.memorySessionId))) {
            throw new TraceApiError(409, "STATE_CONFLICT", null);
          }
          return sendArrival(memory, current, key);
        });
        arrived.current = true;
        onArrivedRef.current(memory.memorySessionId);
        setStatus(replayStatus(result.status) ?? "queued");
        return { ok: true };
      } catch (error) {
        const failure = error instanceof TraceApiError ? error : new TraceApiError(0, "UNKNOWN", null);
        return { ok: false, code: failure.code, message: failure.message, retryAfter: failure.retryAfter };
      } finally {
        reading.current = false;
      }
    },
    [memory],
  );
  useEffect(() => {
    if (!incomingArrivalToken || ended) return;
    let alive = true;
    incomingRead.current ??= read(incomingArrivalToken);
    void incomingRead.current.then((answer) => {
      if (!alive) return;
      if (answer.ok) {
        setStep("replay");
      } else {
        setIncomingFailure(answer);
        setStep("connecting");
      }
    });
    return () => {
      alive = false;
    };
  }, [incomingArrivalToken, ended, read]);

  const visibleStep = ended && (step === "connecting" || step === "scan" || step === "replay") ? "keepsake" : step;

  if (visibleStep === "connecting") return <ArrivalConnecting inert={inert} failure={incomingFailure} onCancel={leave} onScan={() => setStep("scan")} />;
  if (visibleStep === "scan") return <CameraScan inert={inert} initialFailure={incomingFailure} onCancel={leave} onRead={read} onArrived={() => setStep("replay")} />;
  if (visibleStep === "keepsake") {
    return (
      <KeepsakeScreen
        photos={photos}
        deleteAfter={memory.deleteAfter}
        contact={contact}
        inert={inert}
        onDelete={onDelete}
        onLeave={leave}
        onTitle={title}
      />
    );
  }
  return (
    <Replay
      target={target}
      status={status}
      photos={photos.length}
      inert={inert}
      onStatus={setStatus}
      onKeepsake={() => void go(() => setStep("keepsake"))}
      onLeave={leave}
    />
  );
}

/* ------------------------------------------------------------------- scan */

/** A phone camera already opened the booth URL: no in-app camera is needed to send it. */
function ArrivalConnecting({ inert, failure, onCancel, onScan }: {
  inert: boolean;
  failure: Extract<ReadAnswer, { ok: false }> | null;
  onCancel: () => void;
  onScan: () => void;
}) {
  useField("day", { scene: 2, splitOn: 0, invert: 0, imgBg: 1, gain: 1.15, bias: -0.04 }, "scan");
  return (
    <Screen className="scan" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={onCancel}>
            <Icon name="close" />
            やめる
          </button>
        </span>
        <span className="mono">Arrival</span>
        <span className="mono mono--dim">{failure ? "Stopped" : "Connecting"}</span>
      </div>
      <h1 className="h2 scan__head"><Phrases text={failure ? "到着を送信できませんでした" : "ブースにつないでいます"} /></h1>
      {failure ? <p className="note-bar" role="alert"><Sentences text={failure.message} /></p> : <p className="h3" role="status">到着を送信しています…</p>}
      <p className="small"><Sentences text={"QR コードを読み取りました。\nこの画面ではカメラを起動しません。"} /></p>
      {failure && !FINAL_ERRORS.has(failure.code) && (
        <button type="button" className="btn btn--line" onClick={onScan}>QR コードを読み取る</button>
      )}
    </Screen>
  );
}

/** Errors that reading again cannot mend: the participation is over, or the booth is not taking arrivals. */
const FINAL_ERRORS = new Set(["UNAUTHORIZED", "NOT_FOUND", "STATE_CONFLICT", "NOT_AVAILABLE"]);

type Camera = "starting" | "on" | "denied" | "missing" | "busy" | "failed" | "unsupported";

const CAMERA_TROUBLE: Record<Exclude<Camera, "starting" | "on">, string> = {
  denied: "カメラの使用が許可されていません。設定で、このサイトにカメラの使用を許可してから「もう一度試す」を押してください。",
  missing: "カメラが見つかりませんでした。",
  busy: "カメラを起動できませんでした。ほかのアプリがカメラを使っていれば、閉じてから「もう一度試す」を押してください。",
  failed: "カメラを起動できませんでした。「もう一度試す」を押してください。",
  unsupported: "このブラウザではカメラを使えません。Safari か Chrome で開いてください。",
};

/** Without a secure page (https) or camera support, there is no getUserMedia at all. */
function hasCamera(): boolean {
  return typeof navigator.mediaDevices?.getUserMedia === "function";
}

function cameraTrouble(error: unknown): Camera {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "missing";
  if (name === "NotReadableError" || name === "AbortError") return "busy";
  return "failed";
}

/**
 * The rear camera, read a few times a second. Its picture goes through the
 * field as the demo's drawing does; without WebGL, the video itself shows, in
 * grey. Only one code is sent at a time, a refused code is not sent again, and
 * the camera stops whenever the page is hidden and starts again when it is back.
 */
function CameraScan({
  inert,
  initialFailure,
  onCancel,
  onRead,
  onArrived,
}: {
  inert: boolean;
  initialFailure: Extract<ReadAnswer, { ok: false }> | null;
  onCancel: () => void;
  onRead: (code: string) => Promise<ReadAnswer>;
  onArrived: () => void;
}) {
  const { field, fx } = useRay();
  const windowRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackers = useRef<(HTMLDivElement | null)[]>([]);
  const [camera, setCamera] = useState<Camera>(() => (hasCamera() ? "starting" : "unsupported"));
  // Bumped by "もう一度試す" to ask for the camera again.
  const [tries, setTries] = useState(0);
  const [found, setFound] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState(initialFailure?.message ?? "");
  // A final error: nothing more to read.
  const [ended, setEnded] = useState(initialFailure !== null && FINAL_ERRORS.has(initialFailure.code));
  const pretend = useRef<(() => void) | null>(null);
  useField("day", { scene: 2, splitOn: 0, invert: 0, imgBg: 1, gain: 1.15, bias: -0.04 }, "scan");

  const onReadRef = useRef(onRead);
  const onArrivedRef = useRef(onArrived);
  useEffect(() => {
    onReadRef.current = onRead;
    onArrivedRef.current = onArrived;
  }, [onRead, onArrived]);

  useEffect(() => {
    const video = videoRef.current;
    const box = windowRef.current;
    if (!field || !video || !box || ended || !hasCamera()) return;
    let alive = true;
    let stream: MediaStream | null = null;
    let starting = false;
    let timer: number | undefined;
    // A code is on its way, or the screen is leaving: nothing else is sent.
    let busy = false;
    let resumeAt = 0;
    let seenAt = 0;
    let reader: CodeReader | null = null;
    const refused = new Set<string>();
    let noted = "";

    // The camera's picture for the field: dark until the camera is on, then the video at a small size.
    const picture = document.createElement("canvas");
    picture.width = 300;
    picture.height = 400;
    const context = picture.getContext("2d");
    if (!context) return;
    context.fillStyle = "#1d1e20";
    context.fillRect(0, 0, picture.width, picture.height);
    const uv = (): [number, number, number, number] => {
      const rect = box.getBoundingClientRect();
      const canvas = field.canvas.getBoundingClientRect();
      return [(rect.left - canvas.left) / canvas.width, 1 - (rect.bottom - canvas.top) / canvas.height, (rect.right - canvas.left) / canvas.width, 1 - (rect.top - canvas.top) / canvas.height];
    };
    field.image(picture, uv(), true);
    const onResize = () => field.image(picture, uv(), true);
    window.addEventListener("resize", onResize);

    const draw = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const height = Math.round((360 * video.videoHeight) / video.videoWidth);
      if (picture.width !== 360 || picture.height !== height) {
        picture.width = 360;
        picture.height = height;
        context.drawImage(video, 0, 0, picture.width, picture.height);
        field.image(picture, uv(), true);
        return;
      }
      context.drawImage(video, 0, 0, picture.width, picture.height);
      field.image(picture, null, true);
    };

    const stop = () => {
      window.clearTimeout(timer);
      field.follow(null);
      field.stopImage();
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      video.srcObject = null;
    };

    // The four corners onto the window, which shows the video as cover crops it.
    const showCorners = (code: DetectedCode) => {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (code.cornerPoints.length !== 4 || !width || !height) return;
      const rect = box.getBoundingClientRect();
      const boxAspect = rect.width / rect.height;
      const aspect = width / height;
      const cover: [number, number] = aspect > boxAspect ? [boxAspect / aspect, 1] : [1, aspect / boxAspect];
      // The detector goes round from the top left; the trackers go row by row.
      const [topLeft, topRight, bottomRight, bottomLeft] = code.cornerPoints;
      const corners = [topLeft, topRight, bottomLeft, bottomRight].map((point): [number, number] => [point.x / width, point.y / height]);
      placeTrackers(trackers.current, rect, corners, cover);
      setFound(true);
    };

    // The room takes over: the camera tears, stops, and the screen splits to negative.
    const enter = async () => {
      field.burst(1);
      await fx?.tear(420, 1);
      stop();
      await fx?.split(SWAP, 1250);
      flushSync(() => onArrivedRef.current());
      fx?.clear();
    };

    const send = async (code: string) => {
      busy = true;
      setSending(true);
      setNotice("");
      const answer = await onReadRef.current(code);
      if (!alive) return;
      if (answer.ok) {
        await enter();
        return;
      }
      setSending(false);
      setFound(false);
      setNotice(answer.message);
      if (FINAL_ERRORS.has(answer.code)) {
        stop();
        setEnded(true);
        return;
      }
      if (answer.code === "INVALID_CHECKPOINT" || answer.code === "INVALID_ARRIVAL_PROOF") refused.add(code);
      resumeAt = Date.now() + Math.max(RETRY_AFTER_MS, (answer.retryAfter ?? 0) * 1000);
      busy = false;
      // The page was hidden while the code was on its way.
      if (!stream && !document.hidden) void start();
    };
    pretend.current = () => {
      if (!busy) void send("dev-arrival");
    };

    const look = (codes: DetectedCode[]) => {
      const code = codes.find((item) => item.rawValue);
      if (!code) {
        if (seenAt && Date.now() - seenAt > LOST_AFTER_MS) setFound(false);
        return;
      }
      seenAt = Date.now();
      showCorners(code);
      const text = code.rawValue;
      const result = readArrivalQrUrl(text, window.location.origin);
      if (result.kind !== "arrival") {
        if (text !== noted) setNotice(result.kind === "foreign"
          ? "この QR コードは別の参加先のものです。この画面から到着は送信していません。参加を始めた画面で、ブースの QR コードを読み直してください。"
          : "これはこの参加先の到着用 URL ではありません。ASYNC のブースに映っている\nQR コードを読み取ってください。");
        noted = text;
        return;
      }
      if (!refused.has(result.checkpointToken)) void send(result.checkpointToken);
    };

    const scan = async () => {
      if (!alive || !stream) return;
      if (!busy && Date.now() >= resumeAt && video.readyState >= 2) {
        try {
          reader ??= await qrReader();
          const codes = await reader.detect(video);
          if (alive && !busy) look(codes);
        } catch {
          // The reader could not load (on an iPhone it is fetched on first use), or a frame could not be read.
          if (!reader) {
            setNotice("QR コードを読み取る準備ができませんでした。電波の良い場所で、少し待ってください。");
            resumeAt = Date.now() + 3000;
          }
        }
      }
      if (alive && stream) timer = window.setTimeout(() => void scan(), READ_EVERY_MS);
    };

    const start = async () => {
      if (starting || stream) return;
      starting = true;
      setCamera("starting");
      try {
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!alive || document.hidden) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream = next;
        // iPhone Safari plays a muted, inline video without a tap; React does not set the muted attribute itself.
        video.muted = true;
        video.srcObject = next;
        await video.play().catch(() => undefined);
        setCamera("on");
        if (field.ok) field.follow(draw);
        void scan();
      } catch (error) {
        if (alive) setCamera(cameraTrouble(error));
      } finally {
        starting = false;
      }
    };

    // A hidden page lets go of the camera, and takes it again when it is back.
    const onVisibility = () => {
      if (document.hidden) stop();
      else if (!busy) void start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", stop);
    void start();

    return () => {
      alive = false;
      pretend.current = null;
      stop();
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", stop);
    };
  }, [field, fx, tries, ended]);

  const trouble = camera === "starting" || camera === "on" ? null : CAMERA_TROUBLE[camera];
  const retry = trouble !== null && camera !== "missing" && camera !== "unsupported" && !ended;

  return (
    <Screen className="scan" inert={inert}>
      <div className="topbar">
        <span>
          <button type="button" className="link" onClick={onCancel}>
            <Icon name="close" />
            やめる
          </button>
        </span>
        <span className="mono">Scan</span>
        <span className="mono mono--dim">Live</span>
      </div>
      <h1 className="h2 scan__head">
        <Phrases text="展示場の QR コードを読み取ってください" />
      </h1>
      <p className="mono">
        参加先：{process.env.NEXT_PUBLIC_SITE_ORIGIN ? `${process.env.NEXT_PUBLIC_SITE_ORIGIN}/log` : "/log"}
      </p>
      <ScanWindow windowRef={windowRef} trackers={trackers} locked={found || sending}>
        <video ref={videoRef} className={`scan__video${field && !field.ok ? " is-shown" : ""}`} muted playsInline autoPlay aria-hidden="true" />
      </ScanWindow>
      <div className="scan__status">
        <p className="h3" role="status">
          {sending ? "読み取りました" : ended || trouble ? "読み取りを止めています" : camera === "on" ? "読み取っています…" : "カメラを起動しています…"}
        </p>
        <span className="mono">{sending ? "Lock" : ended || trouble ? "Stop" : camera === "on" ? "Searching" : "Camera"}</span>
      </div>
      {(trouble || notice) && (
        <p className="note-bar" role="alert" style={{ marginTop: 12 }}>
          <Sentences text={[notice, trouble].filter(Boolean).join("\n")} />
        </p>
      )}
      {retry && (
        <button type="button" className="btn btn--line" onClick={() => setTries((count) => count + 1)}>
          もう一度試す
        </button>
      )}
      {PRETEND && !ended && (
        <button type="button" className="btn btn--line" style={{ marginTop: 12 }} disabled={sending} onClick={() => pretend.current?.()}>
          開発用：読み取ったことにする
        </button>
      )}
      {ended && (
        <button type="button" className="btn" onClick={onCancel}>
          ホームへもどる
        </button>
      )}
    </Screen>
  );
}

/* ----------------------------------------------------------------- replay */

/** What the screen says: while the replay is ahead or playing, and once the light is back or the screen did not play it. */
function replayText(status: ReplayStatus | null, over: boolean): { title: string; body: string | null } {
  if (over && status === "completed") return { title: "再生が終わりました", body: null };
  if (over && status === "skipped") {
    return {
      title: "スクリーンでは再生できませんでした",
      body: "展示の都合で、今回はスクリーンで再生できませんでした。展示場の QR コードをもう一度読み取ると、また再生を待てます。",
    };
  }
  if (status === "queued" || status === null) return { title: "スクリーンの前でお待ちください", body: null };
  return { title: "スクリーンを見てください", body: null };
}

/** Network failures in a row before the screen says it cannot tell how the replay stands. */
const QUIET_FAILURES = 3;
/**
 * While it plays the phone asks a little more often (20 a minute, still well
 * under TRACE_B's 30), so the light the room's screen pours out at the end
 * reaches the phone while it is still pouring.
 */
const PLAYING_POLL_MS = 3000;

/**
 * Where the replay stands, asked of TRACE_B every few seconds while it is
 * queued or playing and the page is visible. The phone shows next to nothing:
 * the ring, the beam toward the room's screen and one line (relay.tsx), so the
 * visitor looks at the screen. When the replay has played, its light comes
 * back into the ring, and then the photos lead on to the keepsake.
 */
function Replay({
  target,
  status,
  photos,
  inert,
  onStatus,
  onKeepsake,
  onLeave,
}: {
  target: ArrivalTarget;
  status: ReplayStatus | null;
  /** How many photos this phone keeps for the participation. */
  photos: number;
  inert: boolean;
  onStatus: (status: ReplayStatus) => void;
  onKeepsake: () => void;
  onLeave: () => void;
}) {
  const final = isFinal(status);
  // Over before this screen came up (opened again from home): no light comes back.
  const [overAtStart] = useState(final);
  const [settled, setSettled] = useState(false);
  const relay: RelayState = !final ? "send" : status === "skipped" ? "off" : overAtStart ? "done" : "gather";
  const over = final && (relay !== "gather" || settled);
  const [notice, setNotice] = useState("");
  const { experienceId, memory } = target;
  const playing = useRef(status === "playing");
  useEffect(() => {
    playing.current = status === "playing";
  }, [status]);

  const ask = useCallback(async () => {
    const state = await getExperience(experienceId, memory);
    const next = replayStatus(state.replayStatus);
    if (next) onStatus(next);
  }, [experienceId, memory, onStatus]);

  useEffect(() => {
    if (final) return;
    let alive = true;
    let timer: number | undefined;
    let asking = false;
    let failures = 0;
    const poll = async () => {
      window.clearTimeout(timer);
      // A hidden page asks nothing; it asks again as soon as it is back.
      if (!alive || asking || document.hidden) return;
      asking = true;
      let wait = POLL_MS;
      try {
        await ask();
        failures = 0;
        if (alive) setNotice("");
        if (playing.current) wait = PLAYING_POLL_MS;
      } catch (error) {
        const failure = error instanceof TraceApiError ? error : null;
        if (failure && (failure.code === "UNAUTHORIZED" || failure.code === "NOT_FOUND")) {
          if (alive) setNotice(failure.message);
          return;
        }
        failures += 1;
        if (alive && failures >= QUIET_FAILURES) setNotice("再生の状態を確かめられません。電波の良い場所で、そのままお待ちください。");
        wait = failure?.retryAfter ? Math.max(POLL_MS, failure.retryAfter * 1000) : POLL_MS * 2;
      } finally {
        asking = false;
      }
      if (alive) timer = window.setTimeout(() => void poll(), wait);
    };
    timer = window.setTimeout(() => void poll(), playing.current ? PLAYING_POLL_MS : POLL_MS);
    const onVisibility = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [final, ask]);

  const text = replayText(status, over);

  return (
    <Screen className={`screen--relay${over ? " is-over" : ""}`} inert={inert}>
      <header className="mast relay__mast">
        <button type="button" className="icon-btn" aria-label="ホームへもどる" onClick={onLeave}>
          <Icon name="close" />
        </button>
      </header>
      <Relay state={relay} onSettled={() => setSettled(true)} />
      <section className="relay__say" aria-live="polite">
        <h2 className="h2">
          <Phrases text={text.title} />
        </h2>
      </section>
      {notice && (
        <p className="note-bar" role="alert" style={{ marginTop: 18 }}>
          <Sentences text={notice} />
        </p>
      )}
      {over && (
        <div className="relay__after">
          {text.body && (
            <p className="body">
              <Sentences text={text.body} />
            </p>
          )}
          {photos > 0 && (
            <section className="play__next" aria-labelledby="ray-keep">
              <p className="mono">Keepsake</p>
              <h2 className="h3" id="ray-keep">
                作品を保存できます
              </h2>
              <p className="body">
                <Sentences text={"撮った写真を、一枚の作品にまとめました。持ち帰れるのは、この作品と写真です。"} />
              </p>
              <button type="button" className="btn" onClick={onKeepsake}>
                <Icon name="arrow" />
                作品を見る
              </button>
            </section>
          )}
          {photos === 0 && (
            <p className="body" style={{ marginTop: 18 }}>
              <Sentences text={"この端末には写真が残っていないので、作品を作れません。写真を撮ったブラウザで開くと、作品を保存できます。"} />
            </p>
          )}
          <button type="button" className={`btn${photos > 0 ? " btn--line" : ""}`} style={{ marginTop: photos > 0 ? 10 : 18 }} onClick={onLeave}>
            ホームへもどる
          </button>
        </div>
      )}
    </Screen>
  );
}
