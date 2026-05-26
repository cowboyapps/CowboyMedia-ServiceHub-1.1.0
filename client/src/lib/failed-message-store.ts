import { type KbArticleRef } from "@/components/kb-article-picker-dialog";

export interface PersistedFailedMessage {
  id: string;
  ticketId: string;
  senderId: string;
  message: string;
  imageUrl: string | null;
  createdAt: string;
  senderName: string;
  senderRole: string;
  isInternal?: boolean;
  senderAvatarUrl?: string | null;
  kbArticle?: KbArticleRef | null;
  imageFileMeta?: { name: string; type: string } | null;
}

export type RehydratedFailedMessage = PersistedFailedMessage & { imageFile?: File };

const KEY_PREFIX = "servicehub.failed-msgs.";
const DB_NAME = "servicehub-failed-msgs";
const STORE = "images";
const DB_VERSION = 1;

function lsKey(ticketId: string): string {
  return KEY_PREFIX + ticketId;
}

function readArray(ticketId: string): PersistedFailedMessage[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(lsKey(ticketId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as PersistedFailedMessage[]) : [];
  } catch {
    return [];
  }
}

function writeArray(ticketId: string, arr: PersistedFailedMessage[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (arr.length === 0) localStorage.removeItem(lsKey(ticketId));
    else localStorage.setItem(lsKey(ticketId), JSON.stringify(arr));
  } catch {
    // Quota or privacy mode — silently drop persistence.
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function putImage(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

async function getImage(id: string): Promise<Blob | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<Blob | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return result;
}

async function deleteImage(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

export interface PersistFailedInput {
  id: string;
  ticketId: string;
  senderId: string;
  message: string;
  imageUrl: string | null;
  createdAt: string;
  senderName: string;
  senderRole: string;
  isInternal?: boolean;
  senderAvatarUrl?: string | null;
  kbArticle?: KbArticleRef | null;
  imageFile?: File | null;
}

export async function persistFailedMessage(input: PersistFailedInput): Promise<void> {
  const arr = readArray(input.ticketId);
  const entry: PersistedFailedMessage = {
    id: input.id,
    ticketId: input.ticketId,
    senderId: input.senderId,
    message: input.message,
    imageUrl: input.imageUrl ?? null,
    createdAt: input.createdAt,
    senderName: input.senderName,
    senderRole: input.senderRole,
    isInternal: input.isInternal,
    senderAvatarUrl: input.senderAvatarUrl ?? null,
    kbArticle: input.kbArticle ?? null,
    imageFileMeta: input.imageFile
      ? { name: input.imageFile.name, type: input.imageFile.type }
      : null,
  };
  const idx = arr.findIndex((m) => m.id === input.id);
  if (idx === -1) arr.push(entry);
  else arr[idx] = entry;
  writeArray(input.ticketId, arr);
  if (input.imageFile) {
    await putImage(input.id, input.imageFile);
  } else {
    await deleteImage(input.id);
  }
}

export async function removePersistedFailedMessage(ticketId: string, id: string): Promise<void> {
  const arr = readArray(ticketId).filter((m) => m.id !== id);
  writeArray(ticketId, arr);
  await deleteImage(id);
}

export async function loadPersistedFailedMessages(
  ticketId: string,
): Promise<RehydratedFailedMessage[]> {
  const arr = readArray(ticketId);
  if (arr.length === 0) return [];
  return Promise.all(
    arr.map(async (m) => {
      if (!m.imageFileMeta) return m;
      const blob = await getImage(m.id);
      if (!blob) return m;
      const file = new File([blob], m.imageFileMeta.name, { type: m.imageFileMeta.type });
      return { ...m, imageFile: file };
    }),
  );
}
