export type Language = "ja" | "en";
export type SessionMode = "memory" | "live";
export type TrackingStatus = "absent" | "tracking" | "stopped";
export type PresencePhase = "absent" | "approaching" | "arrived" | "on_site";
export type ReplayStatus = "none" | "queued" | "playing" | "completed" | "skipped";
export type PhotoStatus = "ready" | "uploading" | "retry_wait" | "failed";

export type ConsentState = {
  memory: boolean;
  live: boolean;
  camera: boolean;
  singleLocation: boolean;
  liveLocation: boolean;
};

type CredentialMetadata = {
  createdAt: string;
  expiresAt: string;
  deleteAfter: string;
  consentVersion: string;
};

export type MemoryCredential = {
  kind: "memory";
  sessionId: string;
  participantToken: string;
} & CredentialMetadata;

export type LiveCredential = {
  kind: "live";
  sessionId: string;
  participantToken: string;
} & CredentialMetadata;

export type LinkCredential = {
  kind: "link";
  experienceId: string;
  experienceLinkToken: string;
} & CredentialMetadata;

export type ParticipantCredential = MemoryCredential | LiveCredential | LinkCredential;

export type CapturedLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: string;
};

export type PhotoRecord = {
  localSessionRef: string;
  clientPhotoId: string;
  processedBlob: Blob;
  capturedAt: string;
  capturedLocation?: CapturedLocation;
  status: PhotoStatus;
  progress: number;
  hash: string;
  localExpiresAt: number;
  localDeleteAfter: number;
  errorMessage?: string;
};

export type StoryPhoto = PhotoRecord & { url: string };

export type ExperienceSnapshot = {
  memoryEnabled: boolean;
  liveEnabled: boolean;
  trackingStatus: TrackingStatus;
  presencePhase: PresencePhase;
  replayStatus: ReplayStatus;
  arrivalRegistered: boolean;
  arrivalColor: string;
  arrivalSymbol: string;
  uploadedPhotoIds: string[];
  lastLiveSentAt?: string;
};

export type DeletionResult = {
  memory: "deleted" | "failed" | "not_requested";
  live: "deleted" | "failed" | "not_requested";
};

export const SESSION_KEYS = {
  memory: "trace.memory.credential",
  live: "trace.live.credential",
  link: "trace.link.credential",
  consent: "trace.consent.state",
  localSessionRef: "trace.local-session-ref",
} as const;
