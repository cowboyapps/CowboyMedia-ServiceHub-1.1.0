import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  clearDraft as clearDraftStorage,
  isDraftNewerThan,
  readDraft,
  writeDraft,
  type StoredDraft,
} from "@/lib/tiptap-drafts";

export interface UseTiptapDraftResult {
  hasDraft: boolean;
  draftAt: number | null;
  draftHtml: string | null;
  lastSavedAt: number | null;
  restore: () => void;
  discard: () => void;
}

const DEBOUNCE_MS = 3000;

export function useTiptapDraft(
  editor: Editor | null,
  draftKey: string | undefined,
  currentValue: string,
  onApply: (html: string) => void,
): UseTiptapDraftResult {
  const [hasDraft, setHasDraft] = useState(false);
  const [draftAt, setDraftAt] = useState<number | null>(null);
  const [draftHtml, setDraftHtml] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const checkedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Detect existing draft once on mount.
  useEffect(() => {
    if (!draftKey || checkedRef.current) return;
    checkedRef.current = true;
    const existing = readDraft(draftKey);
    if (existing && isDraftNewerThan(existing, currentValue)) {
      setHasDraft(true);
      setDraftAt(existing.savedAt);
      setDraftHtml(existing.html);
    }
  }, [draftKey, currentValue]);

  // Subscribe to editor updates and debounce writes.
  useEffect(() => {
    if (!editor || !draftKey) return;
    const handler = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const html = editor.getHTML();
        const stripped = html.replace(/<[^>]*>/g, "").trim();
        if (!stripped) {
          // Empty content: don't store an empty draft, but clean stale ones.
          clearDraftStorage(draftKey);
          setLastSavedAt(null);
          return;
        }
        const stored = writeDraft(draftKey, html);
        if (stored) setLastSavedAt(stored.savedAt);
      }, DEBOUNCE_MS);
    };
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [editor, draftKey]);

  const restore = useCallback(() => {
    if (!draftHtml) {
      setHasDraft(false);
      return;
    }
    onApply(draftHtml);
    setHasDraft(false);
  }, [draftHtml, onApply]);

  const discard = useCallback(() => {
    if (draftKey) clearDraftStorage(draftKey);
    setHasDraft(false);
    setDraftAt(null);
    setDraftHtml(null);
  }, [draftKey]);

  return { hasDraft, draftAt, draftHtml, lastSavedAt, restore, discard };
}

export type { StoredDraft };
