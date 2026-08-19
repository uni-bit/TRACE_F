"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { cleanupExpiredPhotos, getPhotoUsage, listPhotos, putPhoto, removePhoto } from "@/lib/photo-store";
import { traceApi } from "@/lib/trace-api";
import { SESSION_KEYS } from "@/lib/trace-types";
import type { CapturedLocation, ConsentState, ExperienceSnapshot, Language, LinkCredential, LiveCredential, MemoryCredential, PhotoRecord, StoryPhoto } from "@/lib/trace-types";

type ContextValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  consent: ConsentState;
  setConsent: (consent: ConsentState) => void;
  snapshot: ExperienceSnapshot;
  liveControllerActive: boolean;
  memoryCredential: MemoryCredential | undefined;
  liveCredential: LiveCredential | undefined;
  photos: StoryPhoto[];
  localUsage: { count: number; bytes: number };
  message: string;
  setMessage: (message: string) => void;
  ensureSession: (memory: boolean, live: boolean) => Promise<void>;
  startLive: () => Promise<void>;
  startDemoLive: () => Promise<void>;
  stopLive: () => Promise<void>;
  setOnSite: () => Promise<void>;
  capturePhoto: (file: File, capturedAt: string) => Promise<void>;
  retryPhoto: (photo: PhotoRecord) => Promise<void>;
  deletePhoto: (clientPhotoId: string) => Promise<void>;
  registerArrival: (proof: string) => Promise<void>;
  skipReplay: () => Promise<void>;
  refreshArrival: () => Promise<void>;
  deleteMemory: () => Promise<void>;
  deleteLive: () => Promise<void>;
  deleteBoth: () => Promise<{ memory: "deleted" | "failed" | "not_requested"; live: "deleted" | "failed" | "not_requested" }>;
  setNextBothFailure: () => void;
  setNextUploadFailure: () => void;
};

const ExperienceContext = createContext<ContextValue | null>(null);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasValidCredentialMetadata(value: Record<string, unknown>): boolean {
  if (!isNonEmptyString(value.createdAt) || !isNonEmptyString(value.expiresAt) || !isNonEmptyString(value.deleteAfter) || !isNonEmptyString(value.consentVersion)) return false;
  const createdAt = Date.parse(value.createdAt);
  const expiresAt = Date.parse(value.expiresAt);
  const deleteAfter = Date.parse(value.deleteAfter);
  return Number.isFinite(createdAt) && Number.isFinite(expiresAt) && Number.isFinite(deleteAfter) && expiresAt > Date.now() && deleteAfter >= createdAt;
}

function parseCredential(key: typeof SESSION_KEYS.memory, kind: "memory"): MemoryCredential | undefined;
function parseCredential(key: typeof SESSION_KEYS.live, kind: "live"): LiveCredential | undefined;
function parseCredential(key: typeof SESSION_KEYS.link, kind: "link"): LinkCredential | undefined;
function parseCredential(key: string, kind: "memory" | "live" | "link"): MemoryCredential | LiveCredential | LinkCredential | undefined {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.kind !== kind || !hasValidCredentialMetadata(parsed)) throw new Error("invalid credential");
    if (kind === "link") {
      if (!isNonEmptyString(parsed.experienceId) || !isNonEmptyString(parsed.experienceLinkToken)) throw new Error("invalid link credential");
      return parsed as LinkCredential;
    }
    if (!isNonEmptyString(parsed.sessionId) || !isNonEmptyString(parsed.participantToken)) throw new Error("invalid participant credential");
    return parsed as MemoryCredential | LiveCredential;
  } catch {
    try { sessionStorage.removeItem(key); } catch { /* unavailable storage is treated as absent */ }
    return undefined;
  }
}

function readConsent(): ConsentState {
  const initial: ConsentState = { memory: true, live: true, camera: false, singleLocation: false, liveLocation: false };
  try {
    const raw = sessionStorage.getItem(SESSION_KEYS.consent);
    if (!raw) return initial;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !["memory", "live", "camera", "singleLocation", "liveLocation"].every((key) => typeof parsed[key] === "boolean")) throw new Error("invalid consent");
    return parsed as ConsentState;
  } catch {
    try { sessionStorage.removeItem(SESSION_KEYS.consent); } catch { /* unavailable storage is treated as empty */ }
    return initial;
  }
}

function saveConsent(value: ConsentState): void {
  try { sessionStorage.setItem(SESSION_KEYS.consent, JSON.stringify(value)); } catch { /* unavailable storage is treated as empty */ }
}

function maskSnapshotForCredentials(snapshot: ExperienceSnapshot, memory: MemoryCredential | undefined, live: LiveCredential | undefined, link: LinkCredential | undefined): ExperienceSnapshot {
  const arrivalRegistered = snapshot.arrivalRegistered && Boolean(link);
  return { ...snapshot, memoryEnabled: snapshot.memoryEnabled && Boolean(memory), liveEnabled: snapshot.liveEnabled && Boolean(live), trackingStatus: live ? snapshot.trackingStatus : "absent", presencePhase: live ? snapshot.presencePhase : "absent", arrivalRegistered, replayStatus: arrivalRegistered ? snapshot.replayStatus : "none" };
}

function saveCredential(key: string, value: unknown): void {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function newLocalRef(): string {
  const current = sessionStorage.getItem(SESSION_KEYS.localSessionRef);
  if (current) return current;
  const value = `local-${crypto.randomUUID()}`;
  sessionStorage.setItem(SESSION_KEYS.localSessionRef, value);
  return value;
}

async function digest(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((part) => part.toString(16).padStart(2, "0")).join("");
}

async function processImage(file: File): Promise<{ blob: Blob; hash: string }> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("画像を読み込めませんでした。"));
    });
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const scale = Math.min(1, 1920 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("画像処理を開始できませんでした。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("JPEG変換に失敗しました。")), "image/jpeg", 0.86));
    return { blob, hash: await digest(blob) };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

export function ExperienceProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("ja");
  const [consent, setConsentState] = useState<ConsentState>({ memory: true, live: true, camera: false, singleLocation: false, liveLocation: false });
  const [snapshot, setSnapshot] = useState<ExperienceSnapshot>({ memoryEnabled: false, liveEnabled: false, trackingStatus: "absent", presencePhase: "absent", replayStatus: "none", arrivalRegistered: false, arrivalColor: "#a78bfa", arrivalSymbol: "✦", uploadedPhotoIds: [] });
  const [liveControllerActive, setLiveControllerActive] = useState(false);
  const [memoryCredential, setMemoryCredential] = useState<MemoryCredential>();
  const [liveCredential, setLiveCredential] = useState<LiveCredential>();
  const [photos, setPhotos] = useState<StoryPhoto[]>([]);
  const [localUsage, setLocalUsage] = useState({ count: 0, bytes: 0 });
  const [message, setMessage] = useState("");
  const localRef = useRef("");
  const watchId = useRef<number | null>(null);
  const latestLivePoint = useRef<CapturedLocation | undefined>(undefined);
  const liveSendInFlight = useRef(false);
  const liveActive = useRef(false);
  const liveSendTimer = useRef<number | null>(null);
  const demoLiveTimer = useRef<number | null>(null);
  const lastLiveAttemptAt = useRef(0);
  const trackingGeneration = useRef(0);
  const photosRef = useRef<StoryPhoto[]>([]);
  const memoryCredentialRef = useRef<MemoryCredential | undefined>(undefined);
  const liveCredentialRef = useRef<LiveCredential | undefined>(undefined);
  const linkCredentialRef = useRef<LinkCredential | undefined>(undefined);
  const memoryGeneration = useRef(0);
  const uploadGenerations = useRef(new Map<string, number>());
  const photoTombstones = useRef(new Set<string>());

  const refreshPhotos = useCallback(async () => {
    if (!localRef.current || !memoryCredentialRef.current) {
      setPhotos((previous) => {
        previous.forEach((photo) => URL.revokeObjectURL(photo.url));
        return [];
      });
      setLocalUsage({ count: 0, bytes: 0 });
      return;
    }
    const records = await listPhotos(localRef.current);
    const next = records.map((record) => ({ ...record, url: URL.createObjectURL(record.processedBlob) }));
    setPhotos((previous) => {
      previous.forEach((photo) => URL.revokeObjectURL(photo.url));
      return next;
    });
    setLocalUsage(await getPhotoUsage(localRef.current));
  }, []);

  const refreshSnapshot = useCallback(async (restored?: { memory?: MemoryCredential; live?: LiveCredential; link?: LinkCredential }) => {
    const next = await traceApi.getSnapshot();
    const memory = restored?.memory ?? memoryCredentialRef.current;
    const live = restored?.live ?? liveCredentialRef.current;
    const link = restored?.link ?? linkCredentialRef.current;
    setSnapshot(maskSnapshotForCredentials(next, memory, live, link));
  }, []);

  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    localRef.current = newLocalRef();
    queueMicrotask(() => {
      const restoredMemory = parseCredential(SESSION_KEYS.memory, "memory");
      const restoredLive = parseCredential(SESSION_KEYS.live, "live");
      const restoredLink = parseCredential(SESSION_KEYS.link, "link");
      memoryCredentialRef.current = restoredMemory;
      liveCredentialRef.current = restoredLive;
      linkCredentialRef.current = restoredLink;
      setMemoryCredential(restoredMemory);
      setLiveCredential(restoredLive);
      setConsentState(readConsent());
      void refreshSnapshot({ memory: restoredMemory, live: restoredLive, link: restoredLink });
    });
    void cleanupExpiredPhotos().then(refreshPhotos).catch(() => undefined);
    return () => {
      liveActive.current = false;
      trackingGeneration.current += 1;
      latestLivePoint.current = undefined;
      if (liveSendTimer.current !== null) {
        window.clearTimeout(liveSendTimer.current);
        liveSendTimer.current = null;
      }
      if (demoLiveTimer.current !== null) {
        window.clearInterval(demoLiveTimer.current);
        demoLiveTimer.current = null;
      }
      if (watchId.current !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId.current);
      liveSendInFlight.current = false;
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    };
  }, [refreshPhotos, refreshSnapshot]);

  const setConsent = useCallback((next: ConsentState) => {
    setConsentState(next);
    saveConsent(next);
  }, []);

  const ensureSession = useCallback(async (memory: boolean, live: boolean) => {
    if (memory && !memoryCredential) {
      const credential = await traceApi.createSession("memory");
      saveCredential(SESSION_KEYS.memory, credential);
      if (credential.kind === "memory") {
        memoryCredentialRef.current = credential;
        setMemoryCredential(credential);
      }
    }
    if (live && !liveCredential) {
      const credential = await traceApi.createSession("live");
      saveCredential(SESSION_KEYS.live, credential);
      if (credential.kind === "live") {
        liveCredentialRef.current = credential;
        setLiveCredential(credential);
      }
    }
    await refreshSnapshot();
    setMessage("");
  }, [liveCredential, memoryCredential, refreshSnapshot]);

  const stopLive = useCallback(async () => {
    liveActive.current = false;
    trackingGeneration.current += 1;
    latestLivePoint.current = undefined;
    if (liveSendTimer.current !== null) {
      window.clearTimeout(liveSendTimer.current);
      liveSendTimer.current = null;
    }
    if (demoLiveTimer.current !== null) {
      window.clearInterval(demoLiveTimer.current);
      demoLiveTimer.current = null;
    }
    if (watchId.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    liveSendInFlight.current = false;
    setLiveControllerActive(false);
    await traceApi.stopLive();
    await refreshSnapshot();
    setMessage("Live位置の送信を停止しました。");
  }, [refreshSnapshot]);

  const setOnSite = useCallback(async () => {
    await traceApi.setOnSite();
    await refreshSnapshot();
    setMessage("会場内モードに切り替えました。Live位置は継続中です。");
  }, [refreshSnapshot]);

  const startLive = useCallback(async () => {
    if (!liveCredential || !consent.live) {
      setMessage("先にLive位置の同意を完了してください。");
      return;
    }
    if (!consent.liveLocation) {
      setMessage("Live位置の個別同意を完了してください。");
      return;
    }
    if (!navigator.geolocation) {
      setMessage("このブラウザでは位置情報を利用できません。代替参加をご利用ください。");
      return;
    }
    if (watchId.current !== null) return;
    const generation = trackingGeneration.current + 1;
    trackingGeneration.current = generation;
    try {
      await traceApi.startLive(liveCredential);
    } catch {
      if (generation === trackingGeneration.current) setMessage("Live位置を開始できませんでした。参加状態を確認してください。");
      return;
    }
    if (generation !== trackingGeneration.current) {
      await traceApi.stopLive();
      return;
    }
    liveActive.current = true;
    setLiveControllerActive(true);
    latestLivePoint.current = undefined;
    lastLiveAttemptAt.current = 0;
    liveSendInFlight.current = false;
    setSnapshot((current) => ({ ...current, trackingStatus: "tracking" }));
    const scheduleLiveSend = (): void => {
      if (!liveActive.current || generation !== trackingGeneration.current || !latestLivePoint.current || liveSendTimer.current !== null) return;
      const wait = lastLiveAttemptAt.current === 0 ? 0 : Math.max(0, 5000 - (Date.now() - lastLiveAttemptAt.current));
      liveSendTimer.current = window.setTimeout(() => {
        liveSendTimer.current = null;
        if (!liveActive.current || generation !== trackingGeneration.current || liveSendInFlight.current || !latestLivePoint.current) return;
        const point = latestLivePoint.current;
        latestLivePoint.current = undefined;
        liveSendInFlight.current = true;
        lastLiveAttemptAt.current = Date.now();
        void traceApi.sendLivePoint(liveCredential, point).then((result) => {
          if (liveActive.current && generation === trackingGeneration.current) setSnapshot((current) => ({ ...current, trackingStatus: "tracking", lastLiveSentAt: result.sentAt }));
        }).catch(() => {
          if (liveActive.current && generation === trackingGeneration.current) setMessage("位置の送信に失敗しました。失敗点は保存せず、次の位置を待っています。");
        }).finally(() => {
          if (generation !== trackingGeneration.current) return;
          liveSendInFlight.current = false;
          scheduleLiveSend();
        });
      }, wait);
    };
    watchId.current = navigator.geolocation.watchPosition((position) => {
      if (!liveActive.current || generation !== trackingGeneration.current) return;
      latestLivePoint.current = { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date().toISOString() };
      scheduleLiveSend();
    }, () => {
      if (generation !== trackingGeneration.current) return;
      liveActive.current = false;
      setLiveControllerActive(false);
      trackingGeneration.current += 1;
      if (liveSendTimer.current !== null) {
        window.clearTimeout(liveSendTimer.current);
        liveSendTimer.current = null;
      }
      if (watchId.current !== null) navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
      latestLivePoint.current = undefined;
      setSnapshot((current) => ({ ...current, trackingStatus: "stopped" }));
      setMessage("位置情報を取得できません。Liveを停止して代替参加へ進めます。");
      void traceApi.stopLive();
    }, { enableHighAccuracy: false, maximumAge: 5000, timeout: 8000 });
    setMessage("Live位置の送信を開始しました。");
  }, [consent.live, consent.liveLocation, liveCredential]);

  const startDemoLive = useCallback(async () => {
    if (!liveCredential || !consent.live || !consent.liveLocation) {
      setMessage("Live位置と個別同意を完了してください。");
      return;
    }
    if (watchId.current !== null || demoLiveTimer.current !== null || liveControllerActive) return;
    const generation = trackingGeneration.current + 1;
    trackingGeneration.current = generation;
    try {
      await traceApi.startLive(liveCredential);
    } catch {
      if (generation === trackingGeneration.current) setMessage("デモLiveを開始できませんでした。");
      return;
    }
    if (generation !== trackingGeneration.current) {
      await traceApi.stopLive();
      return;
    }
    liveActive.current = true;
    setLiveControllerActive(true);
    setSnapshot((current) => ({ ...current, trackingStatus: "tracking" }));
    let sequence = 0;
    const sendDemoPoint = (): void => {
      if (!liveActive.current || generation !== trackingGeneration.current) return;
      sequence += 1;
      const point: CapturedLocation = { latitude: 35 + sequence * 0.00001, longitude: 139 + sequence * 0.00001, accuracy: 20, capturedAt: new Date().toISOString() };
      void traceApi.sendLivePoint(liveCredential, point).then((result) => {
        if (liveActive.current && generation === trackingGeneration.current) setSnapshot((current) => ({ ...current, trackingStatus: "tracking", lastLiveSentAt: result.sentAt }));
      }).catch(() => {
        if (liveActive.current && generation === trackingGeneration.current) setMessage("デモ位置の送信に失敗しました。");
      });
    };
    sendDemoPoint();
    demoLiveTimer.current = window.setInterval(sendDemoPoint, 5000);
    setMessage("端末の位置情報を使わず、デモLiveを開始しました。");
  }, [consent.live, consent.liveLocation, liveControllerActive, liveCredential]);

  const beginPhotoUpload = useCallback((clientPhotoId: string): number => {
    const generation = (uploadGenerations.current.get(clientPhotoId) ?? 0) + 1;
    uploadGenerations.current.set(clientPhotoId, generation);
    photoTombstones.current.delete(clientPhotoId);
    return generation;
  }, []);

  const isPhotoUploadCurrent = useCallback((clientPhotoId: string, generation: number): boolean => uploadGenerations.current.get(clientPhotoId) === generation && !photoTombstones.current.has(clientPhotoId), []);

  const cancelPhotoUpload = useCallback((clientPhotoId: string): void => {
    uploadGenerations.current.set(clientPhotoId, (uploadGenerations.current.get(clientPhotoId) ?? 0) + 1);
    photoTombstones.current.add(clientPhotoId);
  }, []);

  const cancelAllPhotoUploads = useCallback((): void => {
    for (const clientPhotoId of uploadGenerations.current.keys()) cancelPhotoUpload(clientPhotoId);
  }, [cancelPhotoUpload]);

  const capturePhoto = useCallback(async (file: File, capturedAt: string) => {
    if (!memoryCredential || !consent.memory) {
      setMessage("写真Memoryの同意を先に完了してください。");
      return;
    }
    if (!consent.camera) {
      setMessage("カメラ利用の個別同意を完了してください。");
      return;
    }
    const memoryVersion = memoryGeneration.current;
    const usage = await getPhotoUsage(localRef.current);
    if (usage.count >= 12) {
      setMessage("端末キューの上限（12枚）に達しています。");
      return;
    }
    let capturedLocation: CapturedLocation | undefined;
    if (consent.singleLocation && navigator.geolocation) {
      try {
        capturedLocation = await new Promise<CapturedLocation>((resolve, reject) => navigator.geolocation.getCurrentPosition((position) => resolve({ latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date().toISOString() }), reject, { maximumAge: 10000, timeout: 6000 }));
      } catch {
        capturedLocation = undefined;
      }
    }
    const processed = await processImage(file);
    if (processed.blob.size > 5 * 1024 * 1024) {
      setMessage("加工後の写真が5MBを超えています。送信・端末保存は行いません。");
      return;
    }
    if (usage.bytes + processed.blob.size > 30 * 1024 * 1024) {
      setMessage("加工後の写真を含めると端末キューの上限（30MB）を超えます。");
      return;
    }
    const now = Date.now();
    if (memoryVersion !== memoryGeneration.current) return;
    const record: PhotoRecord = { localSessionRef: localRef.current, clientPhotoId: `photo-${crypto.randomUUID()}`, processedBlob: processed.blob, capturedAt, capturedLocation, status: "uploading", progress: 0, hash: processed.hash, localExpiresAt: now + 24 * 60 * 60 * 1000, localDeleteAfter: now + 24 * 60 * 60 * 1000 };
    const uploadGeneration = beginPhotoUpload(record.clientPhotoId);
    await putPhoto(record);
    if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) {
      await removePhoto(record.clientPhotoId);
      return;
    }
    await refreshPhotos();
    let progressWrites = Promise.resolve();
    const queueProgressWrite = (progress: number): void => {
      progressWrites = progressWrites.then(async () => {
        if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) return;
        await putPhoto({ ...record, status: "uploading", progress });
        if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) {
          await removePhoto(record.clientPhotoId);
          return;
        }
        await refreshPhotos();
      });
    };
    await traceApi.uploadPhoto(memoryCredential, record, queueProgressWrite).then(async () => {
      await progressWrites;
      if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) return;
      await putPhoto({ ...record, status: "ready", progress: 100 });
      if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) {
        await removePhoto(record.clientPhotoId);
        return;
      }
      await refreshPhotos();
      setMessage("加工済み写真を保存しました。");
    }).catch(async (error: unknown) => {
      await progressWrites;
      if (!isPhotoUploadCurrent(record.clientPhotoId, uploadGeneration)) return;
      const retryable = !(error instanceof Error && "retryable" in error && error.retryable === false);
      await putPhoto({ ...record, status: retryable ? "retry_wait" : "failed", progress: 0, errorMessage: retryable ? "通信を確認して再送してください。" : "サーバーで処理できない写真です。端末保存または削除を選べます。" });
      await refreshPhotos();
      setMessage(retryable ? "アップロードに失敗しました。再送できます。" : "写真を処理できませんでした。端末保存または削除を選べます。");
    });
  }, [beginPhotoUpload, consent.camera, consent.memory, consent.singleLocation, isPhotoUploadCurrent, memoryCredential, refreshPhotos]);

  const retryPhoto = useCallback(async (photo: PhotoRecord) => {
    if (!memoryCredential) return;
    const uploadGeneration = beginPhotoUpload(photo.clientPhotoId);
    await putPhoto({ ...photo, status: "uploading", progress: 0, errorMessage: undefined });
    if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) {
      await removePhoto(photo.clientPhotoId);
      return;
    }
    await refreshPhotos();
    let progressWrites = Promise.resolve();
    const queueProgressWrite = (progress: number): void => {
      progressWrites = progressWrites.then(async () => {
        if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) return;
        await putPhoto({ ...photo, status: "uploading", progress });
        if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) {
          await removePhoto(photo.clientPhotoId);
          return;
        }
        await refreshPhotos();
      });
    };
    try {
      await traceApi.uploadPhoto(memoryCredential, photo, queueProgressWrite);
      await progressWrites;
      if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) return;
      await putPhoto({ ...photo, status: "ready", progress: 100 });
      if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) {
        await removePhoto(photo.clientPhotoId);
        return;
      }
      await refreshPhotos();
      setMessage("写真を再送しました。");
    } catch (error: unknown) {
      await progressWrites;
      if (!isPhotoUploadCurrent(photo.clientPhotoId, uploadGeneration)) return;
      const retryable = !(error instanceof Error && "retryable" in error && error.retryable === false);
      await putPhoto({ ...photo, status: retryable ? "retry_wait" : "failed", progress: 0, errorMessage: retryable ? "通信を確認して再送してください。" : "端末保存または削除を選べます。" });
      await refreshPhotos();
      setMessage(retryable ? "再送に失敗しました。もう一度試せます。" : "写真を処理できませんでした。端末保存または削除を選べます。");
    }
  }, [beginPhotoUpload, isPhotoUploadCurrent, memoryCredential, refreshPhotos]);

  const deletePhoto = useCallback(async (clientPhotoId: string) => {
    if (!memoryCredential) {
      setMessage("写真Memoryのcredentialがないため削除できません。写真は端末に残しています。");
      return;
    }
    cancelPhotoUpload(clientPhotoId);
    try {
      await traceApi.deletePhoto(memoryCredential, clientPhotoId);
      await removePhoto(clientPhotoId);
      await refreshPhotos();
      setMessage("写真を削除しました。");
    } catch {
      photoTombstones.current.delete(clientPhotoId);
      setMessage("写真の削除に失敗しました。端末の写真は保持しています。");
    }
  }, [cancelPhotoUpload, memoryCredential, refreshPhotos]);

  const clearLocalPhotos = useCallback(async () => {
    const records = await listPhotos(localRef.current);
    await Promise.all(records.map((photo) => removePhoto(photo.clientPhotoId)));
    await refreshPhotos();
  }, [refreshPhotos]);

  const registerArrival = useCallback(async (proof: string) => {
    const existingLink = parseCredential(SESSION_KEYS.link, "link");
    const participant = memoryCredentialRef.current;
    if (!participant) {
      setMessage("有効な写真Memoryの参加情報がありません。参加中のタブ（/experience）へ戻ってください。");
      return;
    }
    const link = await traceApi.registerArrival(proof, existingLink);
    saveCredential(SESSION_KEYS.link, link);
    linkCredentialRef.current = link;
    await refreshSnapshot();
    setMessage("到着を登録しました。待機画面へ進めます。");
  }, [refreshSnapshot]);

  const refreshArrival = useCallback(async () => setSnapshot(maskSnapshotForCredentials(await traceApi.getArrivalStatus(), memoryCredentialRef.current, liveCredentialRef.current, linkCredentialRef.current)), []);
  const skipReplay = useCallback(async () => { await traceApi.skipReplay(); await refreshArrival(); }, [refreshArrival]);
  const invalidateLinkCredential = useCallback(() => {
    linkCredentialRef.current = undefined;
    sessionStorage.removeItem(SESSION_KEYS.link);
  }, []);
  const deleteMemory = useCallback(async () => {
    memoryGeneration.current += 1;
    cancelAllPhotoUploads();
    await traceApi.deleteMemory();
    sessionStorage.removeItem(SESSION_KEYS.memory);
    invalidateLinkCredential();
    memoryCredentialRef.current = undefined;
    setMemoryCredential(undefined);
    await clearLocalPhotos();
    await refreshSnapshot();
    setMessage("写真Memoryと端末内の加工済み写真を削除しました。");
  }, [cancelAllPhotoUploads, clearLocalPhotos, invalidateLinkCredential, refreshSnapshot]);
  const deleteLive = useCallback(async () => {
    await stopLive();
    await traceApi.deleteLive();
    sessionStorage.removeItem(SESSION_KEYS.live);
    invalidateLinkCredential();
    liveCredentialRef.current = undefined;
    setLiveCredential(undefined);
    await refreshSnapshot();
    setMessage("Liveデータを削除しました。");
  }, [invalidateLinkCredential, refreshSnapshot, stopLive]);
  const deleteBoth = useCallback(async () => {
    memoryGeneration.current += 1;
    cancelAllPhotoUploads();
    await stopLive();
    const result = await traceApi.deleteBoth();
    if (result.memory === "deleted" || result.live === "deleted") invalidateLinkCredential();
    if (result.memory === "deleted") {
      sessionStorage.removeItem(SESSION_KEYS.memory);
      memoryCredentialRef.current = undefined;
      setMemoryCredential(undefined);
      await clearLocalPhotos();
    }
    if (result.live === "deleted") {
      sessionStorage.removeItem(SESSION_KEYS.live);
      liveCredentialRef.current = undefined;
      setLiveCredential(undefined);
    }
    await refreshSnapshot();
    setMessage(result.live === "failed" ? "Memoryは削除済み、Liveの削除だけ失敗しました。Liveだけ再試行できます。" : "MemoryとLiveを削除しました。");
    return result;
  }, [cancelAllPhotoUploads, clearLocalPhotos, invalidateLinkCredential, refreshSnapshot, stopLive]);
  const setNextBothFailure = useCallback(() => traceApi.setNextBothFailure(), []);
  const setNextUploadFailure = useCallback(() => traceApi.setNextUploadFailure(), []);

  const value = useMemo<ContextValue>(() => ({ language, setLanguage, consent, setConsent, snapshot, liveControllerActive, memoryCredential, liveCredential, photos, localUsage, message, setMessage, ensureSession, startLive, startDemoLive, stopLive, setOnSite, capturePhoto, retryPhoto, deletePhoto, registerArrival, skipReplay, refreshArrival, deleteMemory, deleteLive, deleteBoth, setNextBothFailure, setNextUploadFailure }), [language, consent, setConsent, snapshot, liveControllerActive, memoryCredential, liveCredential, photos, localUsage, message, ensureSession, startLive, startDemoLive, stopLive, setOnSite, capturePhoto, retryPhoto, deletePhoto, registerArrival, skipReplay, refreshArrival, deleteMemory, deleteLive, deleteBoth, setNextBothFailure, setNextUploadFailure]);
  return <ExperienceContext.Provider value={value}>{children}</ExperienceContext.Provider>;
}

export function useExperience(): ContextValue {
  const context = useContext(ExperienceContext);
  if (!context) throw new Error("ExperienceProviderの外ではuseExperienceを使えません。");
  return context;
}
