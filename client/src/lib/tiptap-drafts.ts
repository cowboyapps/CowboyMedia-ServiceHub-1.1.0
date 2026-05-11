export const DRAFT_PREFIX = "tiptap-draft:";
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoredDraft {
  html: string;
  savedAt: number;
}

export function buildDraftStorageKey(draftKey: string): string {
  return `${DRAFT_PREFIX}${draftKey}`;
}

function getStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readDraft(draftKey: string, storage?: Storage): StoredDraft | null {
  const s = getStorage(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(buildDraftStorageKey(draftKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredDraft>;
    if (typeof parsed.html !== "string" || typeof parsed.savedAt !== "number") return null;
    return { html: parsed.html, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function writeDraft(
  draftKey: string,
  html: string,
  storage?: Storage,
  now: () => number = Date.now,
): StoredDraft | null {
  const s = getStorage(storage);
  if (!s) return null;
  const draft: StoredDraft = { html, savedAt: now() };
  try {
    s.setItem(buildDraftStorageKey(draftKey), JSON.stringify(draft));
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft(draftKey: string, storage?: Storage): void {
  const s = getStorage(storage);
  if (!s) return;
  try {
    s.removeItem(buildDraftStorageKey(draftKey));
  } catch {
    // ignore
  }
}

export function pruneOldDrafts(
  storage?: Storage,
  now: () => number = Date.now,
  ttlMs: number = DRAFT_TTL_MS,
): number {
  const s = getStorage(storage);
  if (!s) return 0;
  const cutoff = now() - ttlMs;
  const toDelete: string[] = [];
  try {
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i);
      if (!key || !key.startsWith(DRAFT_PREFIX)) continue;
      const raw = s.getItem(key);
      if (!raw) {
        toDelete.push(key);
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<StoredDraft>;
        if (typeof parsed.savedAt !== "number" || parsed.savedAt < cutoff) {
          toDelete.push(key);
        }
      } catch {
        toDelete.push(key);
      }
    }
    for (const key of toDelete) s.removeItem(key);
  } catch {
    // ignore
  }
  return toDelete.length;
}

export function isDraftNewerThan(
  draft: StoredDraft | null,
  loadedHtml: string | null | undefined,
): boolean {
  if (!draft) return false;
  const loaded = (loadedHtml ?? "").trim();
  const draftHtml = draft.html.trim();
  if (!draftHtml) return false;
  if (draftHtml === loaded) return false;
  return true;
}
