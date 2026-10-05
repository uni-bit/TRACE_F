/**
 * Device-local store for the timed photo log (`/log`).
 *
 * Nothing here leaves the phone yet: there is no backend to send to, so an
 * entry is "sent" by being written here. When the upload endpoint exists,
 * `sentAt` is the field to fill in after a successful POST.
 */

export type PingLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
};

export type PingEntry = {
  id: string;
  /** When the timer rang for this entry, or null for a photo taken off-schedule. */
  promptedAt: string | null;
  takenAt: string;
  location: PingLocation | null;
  /** Why there is no location, when there is none. */
  locationError: string | null;
  photo: Blob;
  sentAt: string | null;
};

const DB_NAME = "trace-ping-log";
const STORE_NAME = "entries";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

export async function listEntries(): Promise<PingEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as PingEntry[]).sort((a, b) => b.takenAt.localeCompare(a.takenAt)));
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

export async function putEntry(entry: PingEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("記録を保存できませんでした。"));
  });
}

export async function clearEntries(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("記録を削除できませんでした。"));
  });
}
