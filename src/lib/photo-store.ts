import type { PhotoRecord } from "@/lib/trace-types";

const DB_NAME = "trace-photo-queue";
const STORE_NAME = "photos";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "clientPhotoId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

export async function listPhotos(localSessionRef?: string): Promise<PhotoRecord[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => {
      const all = request.result as PhotoRecord[];
      resolve(localSessionRef ? all.filter((photo) => photo.localSessionRef === localSessionRef) : all);
    };
    request.onerror = () => reject(request.error ?? new Error("写真を読み込めませんでした。"));
  });
}

export async function putPhoto(photo: PhotoRecord): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(photo);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("写真を保存できませんでした。"));
  });
}

export async function removePhoto(clientPhotoId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(clientPhotoId);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("写真を削除できませんでした。"));
  });
}

async function purgeExpiredPhotos(): Promise<number> {
  const photos = await listPhotos();
  const expired = photos.filter((photo) => Math.min(photo.localExpiresAt, photo.localDeleteAfter) <= Date.now());
  await Promise.all(expired.map((photo) => removePhoto(photo.clientPhotoId)));
  return expired.length;
}

export async function cleanupExpiredPhotos(): Promise<number> {
  if (typeof navigator === "undefined" || !navigator.locks) return purgeExpiredPhotos();
  return navigator.locks.request("trace:local-cleanup", { ifAvailable: true }, async (lock) => lock ? purgeExpiredPhotos() : 0);
}

export async function getPhotoUsage(localSessionRef: string): Promise<{ count: number; bytes: number }> {
  const photos = await listPhotos(localSessionRef);
  return { count: photos.length, bytes: photos.reduce((sum, photo) => sum + photo.processedBlob.size, 0) };
}
