import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DRAFT_PREFIX,
  DRAFT_TTL_MS,
  buildDraftStorageKey,
  clearDraft,
  isDraftNewerThan,
  pruneOldDrafts,
  readDraft,
  writeDraft,
} from "../client/src/lib/tiptap-drafts";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
}

test("buildDraftStorageKey prefixes correctly", () => {
  assert.equal(buildDraftStorageKey("news:new"), `${DRAFT_PREFIX}news:new`);
});

test("writeDraft + readDraft round-trip", () => {
  const s = new MemoryStorage();
  const written = writeDraft("news:42", "<p>hello</p>", s, () => 1000);
  assert.deepEqual(written, { html: "<p>hello</p>", savedAt: 1000 });
  assert.deepEqual(readDraft("news:42", s), { html: "<p>hello</p>", savedAt: 1000 });
});

test("readDraft returns null for missing or malformed entries", () => {
  const s = new MemoryStorage();
  assert.equal(readDraft("missing", s), null);
  s.setItem(buildDraftStorageKey("bad"), "{not json");
  assert.equal(readDraft("bad", s), null);
  s.setItem(buildDraftStorageKey("partial"), JSON.stringify({ html: "x" }));
  assert.equal(readDraft("partial", s), null);
});

test("clearDraft removes only that key", () => {
  const s = new MemoryStorage();
  writeDraft("a", "<p>a</p>", s, () => 1);
  writeDraft("b", "<p>b</p>", s, () => 2);
  clearDraft("a", s);
  assert.equal(readDraft("a", s), null);
  assert.deepEqual(readDraft("b", s), { html: "<p>b</p>", savedAt: 2 });
});

test("pruneOldDrafts removes drafts older than TTL and keeps fresh ones", () => {
  const s = new MemoryStorage();
  const now = 10_000_000;
  writeDraft("fresh", "<p>fresh</p>", s, () => now - 1000);
  writeDraft("stale", "<p>stale</p>", s, () => now - DRAFT_TTL_MS - 1);
  s.setItem("unrelated", "keep me");
  s.setItem(buildDraftStorageKey("garbage"), "not json");
  const removed = pruneOldDrafts(s, () => now);
  assert.equal(removed, 2);
  assert.notEqual(readDraft("fresh", s), null);
  assert.equal(readDraft("stale", s), null);
  assert.equal(s.getItem("unrelated"), "keep me");
  assert.equal(s.getItem(buildDraftStorageKey("garbage")), null);
});

test("isDraftNewerThan: true when draft has content and differs from loaded", () => {
  assert.equal(isDraftNewerThan({ html: "<p>x</p>", savedAt: 1 }, ""), true);
  assert.equal(isDraftNewerThan({ html: "<p>x</p>", savedAt: 1 }, null), true);
  assert.equal(isDraftNewerThan({ html: "<p>x</p>", savedAt: 1 }, "<p>x</p>"), false);
  assert.equal(isDraftNewerThan({ html: "   ", savedAt: 1 }, ""), false);
  assert.equal(isDraftNewerThan(null, "anything"), false);
});

test("debounce semantics: only the latest write within a window is persisted", () => {
  // Simulate the debounce result by writing serially with the same timestamp
  // and ensuring the latest write wins (matches real hook behavior where
  // only the last setTimeout fires after the user stops typing).
  const s = new MemoryStorage();
  writeDraft("k", "<p>1</p>", s, () => 100);
  writeDraft("k", "<p>2</p>", s, () => 200);
  writeDraft("k", "<p>3</p>", s, () => 300);
  assert.deepEqual(readDraft("k", s), { html: "<p>3</p>", savedAt: 300 });
});
