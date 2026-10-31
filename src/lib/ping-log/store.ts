/**
 * Device-local store for the timed log (`/log`).
 *
 * Every record is written here and stays: a participant's photos are never
 * sent (#54), only the checkpoint and time of each go to TRACE_B (#13), and
 * the developer screen's older records carry where they were taken, which
 * never leaves the phone (#39); `sentAt` marks the ones the push worker
 * acknowledged before. They stay until the participant deletes them. Every
 * change is told to /log's other tabs.
 */

import type { LogRecord } from "./record";
import { tellOtherTabs } from "./tabs";

export type LogEntry = {
  id: string;
  record: LogRecord;
  /** The shrunk JPEG, when a photo was attached. */
  photo: Blob | null;
  sentAt: string | null;
  /**
   * The backend's memory session a photo was taken in, when the backend is
   * connected: the photo limit counts per session. Kept on the phone only; the
   * push worker gets the record, not this.
   */
  memorySessionId?: string;
  /**
   * TRACE_B's record of the photo's checkpoint and time (#13), once it has
   * one. Absent while that is still to be sent; null when it never will be:
   * the photo was taken after the arrival, or TRACE_B turned it down.
   */
  photoMomentId?: string | null;
};

/** Where a saved entry ended up: with the worker, waiting here for a signal, or here only (no worker configured). */
export type SaveOutcome = "sent" | "queued" | "local";

const DB_NAME = "trace-ping-log";
const STORE_NAME = "entries";
/** Keep old object stores intact when opening an earlier database version. */
const VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer version opened in another tab waits until this one lets go.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

export async function listEntries(): Promise<LogEntry[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as LogEntry[])
      .filter((entry) => typeof entry?.record?.takenAt === "string")
      .sort((a, b) => b.record.takenAt.localeCompare(a.record.takenAt)));
    request.onerror = () => reject(request.error ?? new Error("記録を読み込めませんでした。"));
  });
}

export async function putEntry(entry: LogEntry): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(entry);
    tx.oncomplete = () => {
      tellOtherTabs();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("記録を保存できませんでした。"));
    // A full disk shows only as an abort (Safari), never as an error; without this the save would wait forever.
    tx.onabort = tx.onerror;
  });
}

/** Erases one entry: a participant's photo they deleted (#51). */
export async function deleteEntry(id: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => {
      tellOtherTabs();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("写真を削除できませんでした。"));
    tx.onabort = tx.onerror;
  });
}

export async function clearEntries(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      tellOtherTabs();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("記録を削除できませんでした。"));
    tx.onabort = tx.onerror;
  });
}

/** Erases every photo kept for a backend participation; the developer screen's records stay. */
export async function clearSessionEntries(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const request = tx.objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if ((cursor.value as LogEntry).memorySessionId) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => {
      tellOtherTabs();
      resolve();
    };
    tx.onerror = () => reject(tx.error ?? new Error("記録を削除できませんでした。"));
    tx.onabort = tx.onerror;
  });
}
