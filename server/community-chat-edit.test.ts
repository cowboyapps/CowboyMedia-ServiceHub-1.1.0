import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCommunityMessageEdit, COMMUNITY_EDIT_WINDOW_MS } from "./community-chat-edit";

const NOW = new Date("2026-07-08T12:00:00Z");
const baseMsg = (over: Partial<{ userId: string; createdAt: Date; pollId: string | null }> = {}) => ({
  userId: "u1",
  createdAt: new Date(NOW.getTime() - 60_000),
  pollId: null,
  ...over,
});

const baseInput = {
  requesterId: "u1",
  isAdmin: false,
  newContent: "hello",
  hasImage: false,
  hasKbArticle: false,
  now: NOW,
};

test("author can edit within the window", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, message: baseMsg() });
  assert.deepEqual(r, { ok: true });
});

test("missing message → 404", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, message: undefined });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 404);
});

test("poll messages cannot be edited", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, message: baseMsg({ pollId: "p1" }) });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("non-author non-admin → 403", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, requesterId: "u2", message: baseMsg() });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
});

test("admin may edit someone else's message", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, requesterId: "admin", isAdmin: true, message: baseMsg() });
  assert.deepEqual(r, { ok: true });
});

test("author blocked after the 15-minute window", () => {
  const old = baseMsg({ createdAt: new Date(NOW.getTime() - COMMUNITY_EDIT_WINDOW_MS - 1000) });
  const r = checkCommunityMessageEdit({ ...baseInput, message: old });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.match(r.error, /15 minutes/);
  }
});

test("admin ignores the window", () => {
  const old = baseMsg({ createdAt: new Date(NOW.getTime() - 10 * COMMUNITY_EDIT_WINDOW_MS) });
  const r = checkCommunityMessageEdit({ ...baseInput, isAdmin: true, message: old });
  assert.deepEqual(r, { ok: true });
});

test("empty content rejected unless an image or KB link remains", () => {
  const empty = { ...baseInput, newContent: "   ", message: baseMsg() };
  const r1 = checkCommunityMessageEdit(empty);
  assert.equal(r1.ok, false);
  const r2 = checkCommunityMessageEdit({ ...empty, hasImage: true });
  assert.deepEqual(r2, { ok: true });
  const r3 = checkCommunityMessageEdit({ ...empty, hasKbArticle: true });
  assert.deepEqual(r3, { ok: true });
});

test("over-long content rejected", () => {
  const r = checkCommunityMessageEdit({ ...baseInput, newContent: "x".repeat(2001), message: baseMsg() });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});
