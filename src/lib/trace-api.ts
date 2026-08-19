import type {
  CapturedLocation,
  DeletionResult,
  ExperienceSnapshot,
  LiveCredential,
  LinkCredential,
  MemoryCredential,
  PhotoRecord,
  PresencePhase,
  ReplayStatus,
  SessionMode,
  TrackingStatus,
} from "@/lib/trace-types";

export interface TraceApi {
  createSession(mode: SessionMode): Promise<MemoryCredential | LiveCredential>;
  getSnapshot(): Promise<ExperienceSnapshot>;
  startLive(credential: LiveCredential): Promise<void>;
  sendLivePoint(credential: LiveCredential, point: CapturedLocation): Promise<{ sentAt: string }>;
  uploadPhoto(credential: MemoryCredential, photo: PhotoRecord, onProgress: (progress: number) => void): Promise<void>;
  deletePhoto(credential: MemoryCredential, clientPhotoId: string): Promise<void>;
  registerArrival(proof: string, credential?: LinkCredential): Promise<LinkCredential>;
  getArrivalStatus(): Promise<ExperienceSnapshot>;
  skipReplay(): Promise<void>;
  setOnSite(): Promise<void>;
  stopLive(): Promise<void>;
  deleteMemory(): Promise<void>;
  deleteLive(): Promise<void>;
  deleteBoth(): Promise<DeletionResult>;
}

const MOCK_STATE_KEY = "trace.mock.nonSensitiveState";
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

type MockState = {
  snapshot: ExperienceSnapshot;
  failureNextBoth: boolean;
  failureNextUpload: boolean;
  deletedPhotoIds: string[];
};

const initialSnapshot = (): ExperienceSnapshot => ({
  memoryEnabled: false,
  liveEnabled: false,
  trackingStatus: "absent",
  presencePhase: "absent",
  replayStatus: "none",
  arrivalRegistered: false,
  arrivalColor: "#a78bfa",
  arrivalSymbol: "✦",
  uploadedPhotoIds: [],
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === "string" && values.includes(value as T);
}

function isValidSnapshot(value: unknown): value is ExperienceSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.memoryEnabled === "boolean"
    && typeof value.liveEnabled === "boolean"
    && isOneOf<TrackingStatus>(value.trackingStatus, ["absent", "tracking", "stopped"])
    && isOneOf<PresencePhase>(value.presencePhase, ["absent", "approaching", "arrived", "on_site"])
    && isOneOf<ReplayStatus>(value.replayStatus, ["none", "queued", "playing", "completed", "skipped"])
    && typeof value.arrivalRegistered === "boolean"
    && typeof value.arrivalColor === "string"
    && typeof value.arrivalSymbol === "string"
    && Array.isArray(value.uploadedPhotoIds)
    && value.uploadedPhotoIds.every((id) => typeof id === "string")
    && (value.lastLiveSentAt === undefined || typeof value.lastLiveSentAt === "string");
}

function readPersistedState(): MockState | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(MOCK_STATE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !isValidSnapshot(parsed.snapshot) || typeof parsed.failureNextBoth !== "boolean" || typeof parsed.failureNextUpload !== "boolean") throw new Error("invalid mock state");
    const deletedPhotoIds = parsed.deletedPhotoIds === undefined ? [] : parsed.deletedPhotoIds;
    if (!Array.isArray(deletedPhotoIds) || !deletedPhotoIds.every((id) => typeof id === "string")) throw new Error("invalid photo tombstones");
    return { snapshot: parsed.snapshot, failureNextBoth: parsed.failureNextBoth, failureNextUpload: parsed.failureNextUpload, deletedPhotoIds };
  } catch {
    try { sessionStorage.removeItem(MOCK_STATE_KEY); } catch { /* unavailable storage is treated as empty */ }
    return undefined;
  }
}

function persistState(current: MockState): void {
  if (typeof window === "undefined") return;
  try {
    // This object deliberately contains no Memory, Live, or Link credential.
    sessionStorage.setItem(MOCK_STATE_KEY, JSON.stringify({ snapshot: current.snapshot, failureNextBoth: current.failureNextBoth, failureNextUpload: current.failureNextUpload, deletedPhotoIds: current.deletedPhotoIds }));
  } catch {
    // Mock state remains usable in memory when storage is unavailable.
  }
}

let state: MockState | undefined;

function getState(): MockState {
  state ??= readPersistedState() ?? { snapshot: initialSnapshot(), failureNextBoth: false, failureNextUpload: false, deletedPhotoIds: [] };
  return state;
}

function credentialDates(): { createdAt: string; expiresAt: string; deleteAfter: string; consentVersion: string } {
  const createdAt = new Date().toISOString();
  return { createdAt, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), deleteAfter: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), consentVersion: "trace-consent-v2" };
}

function uploadBlocked(current: MockState, clientPhotoId: string): boolean {
  return !current.snapshot.memoryEnabled || current.deletedPhotoIds.includes(clientPhotoId);
}

function invalidateLink(current: MockState): void {
  current.snapshot.arrivalRegistered = false;
  current.snapshot.replayStatus = "none";
}

export class MockTraceApi implements TraceApi {
  async createSession(mode: SessionMode): Promise<MemoryCredential | LiveCredential> {
    const current = getState();
    const id = `demo-${mode}-${crypto.randomUUID()}`;
    const dates = credentialDates();
    const credential = mode === "memory"
      ? { kind: "memory" as const, sessionId: id, participantToken: `memory-demo-${crypto.randomUUID()}`, ...dates }
      : { kind: "live" as const, sessionId: id, participantToken: `live-demo-${crypto.randomUUID()}`, ...dates };
    if (mode === "memory") current.snapshot.memoryEnabled = true;
    if (mode === "live") {
      current.snapshot.liveEnabled = true;
      current.snapshot.trackingStatus = "stopped";
      current.snapshot.presencePhase = "approaching";
    }
    persistState(current);
    return credential;
  }

  async getSnapshot(): Promise<ExperienceSnapshot> {
    return structuredClone(getState().snapshot);
  }

  async startLive(credential: LiveCredential): Promise<void> {
    void credential;
    const current = getState();
    if (!current.snapshot.liveEnabled) throw new Error("Live位置の参加がありません。");
    current.snapshot.trackingStatus = "tracking";
    persistState(current);
  }

  async sendLivePoint(credential: LiveCredential, point: CapturedLocation): Promise<{ sentAt: string }> {
    void credential;
    void point;
    const before = getState();
    if (before.snapshot.trackingStatus !== "tracking") throw new Error("late live point rejected");
    await sleep(180);
    const current = getState();
    if (current.snapshot.trackingStatus !== "tracking") throw new Error("late live point rejected");
    const sentAt = new Date().toISOString();
    current.snapshot.lastLiveSentAt = sentAt;
    persistState(current);
    return { sentAt };
  }

  async uploadPhoto(credential: MemoryCredential, photo: PhotoRecord, onProgress: (progress: number) => void): Promise<void> {
    void credential;
    const current = getState();
    if (uploadBlocked(current, photo.clientPhotoId)) throw new Error("photo upload cancelled");
    for (const progress of [18, 42, 68, 100]) {
      await sleep(160);
      if (uploadBlocked(current, photo.clientPhotoId)) throw new Error("photo upload cancelled");
      onProgress(progress);
    }
    if (current.failureNextUpload) {
      current.failureNextUpload = false;
      persistState(current);
      const error = new Error("mock network interruption") as Error & { retryable: boolean };
      error.retryable = true;
      throw error;
    }
    current.snapshot.uploadedPhotoIds = Array.from(new Set([...current.snapshot.uploadedPhotoIds, photo.clientPhotoId]));
    persistState(current);
  }

  async deletePhoto(credential: MemoryCredential, clientPhotoId: string): Promise<void> {
    void credential;
    const current = getState();
    if (!current.deletedPhotoIds.includes(clientPhotoId)) current.deletedPhotoIds.push(clientPhotoId);
    current.snapshot.uploadedPhotoIds = current.snapshot.uploadedPhotoIds.filter((id) => id !== clientPhotoId);
    persistState(current);
  }

  async registerArrival(proof: string, credential?: LinkCredential): Promise<LinkCredential> {
    await sleep(220);
    if (!proof) throw new Error("到着証明がありません。");
    const current = getState();
    if (current.snapshot.arrivalRegistered && credential) return credential;
    current.snapshot.arrivalRegistered = true;
    current.snapshot.replayStatus = current.snapshot.replayStatus === "none" ? "queued" : current.snapshot.replayStatus;
    if (current.snapshot.presencePhase !== "on_site") current.snapshot.presencePhase = current.snapshot.liveEnabled ? "arrived" : "absent";
    persistState(current);
    return credential ?? { kind: "link", experienceId: "demo-experience", experienceLinkToken: `link-demo-${crypto.randomUUID()}`, ...credentialDates() };
  }

  async getArrivalStatus(): Promise<ExperienceSnapshot> {
    const current = getState();
    if (current.snapshot.replayStatus === "queued") current.snapshot.replayStatus = "playing";
    else if (current.snapshot.replayStatus === "playing") current.snapshot.replayStatus = "completed";
    persistState(current);
    return structuredClone(current.snapshot);
  }

  async skipReplay(): Promise<void> {
    const current = getState();
    current.snapshot.replayStatus = "skipped";
    persistState(current);
  }

  async setOnSite(): Promise<void> {
    const current = getState();
    if (!current.snapshot.arrivalRegistered) throw new Error("到着登録後に会場内モードへ進めます。");
    if (!current.snapshot.liveEnabled) throw new Error("Live位置の参加が必要です。");
    if (current.snapshot.trackingStatus !== "tracking") throw new Error("Live位置を開始してから会場内モードへ進めます。");
    current.snapshot.presencePhase = "on_site";
    persistState(current);
  }

  async stopLive(): Promise<void> {
    const current = getState();
    current.snapshot.trackingStatus = current.snapshot.liveEnabled ? "stopped" : "absent";
    persistState(current);
  }

  async deleteMemory(): Promise<void> {
    await sleep(260);
    const current = getState();
    current.snapshot.memoryEnabled = false;
    current.deletedPhotoIds = Array.from(new Set([...current.deletedPhotoIds, ...current.snapshot.uploadedPhotoIds]));
    current.snapshot.uploadedPhotoIds = [];
    invalidateLink(current);
    persistState(current);
  }

  async deleteLive(): Promise<void> {
    await sleep(260);
    const current = getState();
    current.snapshot.liveEnabled = false;
    current.snapshot.trackingStatus = "absent";
    current.snapshot.presencePhase = "absent";
    delete current.snapshot.lastLiveSentAt;
    invalidateLink(current);
    persistState(current);
  }

  async deleteBoth(): Promise<DeletionResult> {
    await sleep(350);
    const current = getState();
    const result: DeletionResult = current.failureNextBoth
      ? { memory: "deleted", live: "failed" }
      : { memory: "deleted", live: "deleted" };
    current.failureNextBoth = false;
    if (result.memory === "deleted") {
      current.snapshot.memoryEnabled = false;
      current.deletedPhotoIds = Array.from(new Set([...current.deletedPhotoIds, ...current.snapshot.uploadedPhotoIds]));
      current.snapshot.uploadedPhotoIds = [];
    }
    if (result.live === "deleted") {
      current.snapshot.liveEnabled = false;
      current.snapshot.trackingStatus = "absent";
      current.snapshot.presencePhase = "absent";
      delete current.snapshot.lastLiveSentAt;
    }
    if (result.memory === "deleted" || result.live === "deleted") invalidateLink(current);
    persistState(current);
    return result;
  }

  setNextBothFailure(): void {
    const current = getState();
    current.failureNextBoth = true;
    persistState(current);
  }

  setNextUploadFailure(): void {
    const current = getState();
    current.failureNextUpload = true;
    persistState(current);
  }
}

export const traceApi: MockTraceApi = new MockTraceApi();
