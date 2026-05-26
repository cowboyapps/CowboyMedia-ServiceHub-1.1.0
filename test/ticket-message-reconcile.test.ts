import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeIncomingMessageIntoCache,
  removeMatchingOptimistic,
  type ReconcileMessage,
  type ReconcileOptimistic,
} from "../shared/ticket-message-reconcile";

function msg(over: Partial<ReconcileMessage> = {}): ReconcileMessage {
  return {
    id: "m-server",
    senderId: "user-1",
    message: "hello",
    isInternal: false,
    ...over,
  };
}

function opt(over: Partial<ReconcileOptimistic> = {}): ReconcileOptimistic {
  return {
    id: "optimistic-1",
    senderId: "user-1",
    message: "hello",
    isInternal: false,
    status: "sending",
    ...over,
  };
}

// --- mergeIncomingMessageIntoCache: prev === undefined branch ------------

test("mergeIncomingMessageIntoCache seeds the cache when prev is undefined", () => {
  const incoming = msg();
  const next = mergeIncomingMessageIntoCache<ReconcileMessage>(undefined, incoming);
  assert.deepEqual(next, [incoming]);
});

// --- mergeIncomingMessageIntoCache: matching id branch -------------------

test("mergeIncomingMessageIntoCache returns prev unchanged when id already present (double broadcast)", () => {
  const existing = msg();
  const prev = [existing];
  const next = mergeIncomingMessageIntoCache(prev, msg());
  assert.equal(next, prev, "should return the exact prev reference, not a copy");
  assert.equal(next.length, 1);
});

test("mergeIncomingMessageIntoCache appends a brand-new id", () => {
  const prev = [msg({ id: "m-1" })];
  const next = mergeIncomingMessageIntoCache(prev, msg({ id: "m-2" }));
  assert.equal(next.length, 2);
  assert.deepEqual(
    next.map((m) => m.id),
    ["m-1", "m-2"],
  );
});

// --- removeMatchingOptimistic: same sender+text optimistic branch --------

test("removeMatchingOptimistic drops the single oldest pending entry matching sender+text+isInternal", () => {
  const prev = [
    opt({ id: "opt-old", message: "ok" }),
    opt({ id: "opt-new", message: "ok" }),
  ];
  const next = removeMatchingOptimistic(prev, msg({ id: "srv", message: "ok" }), "user-1");
  assert.equal(next.length, 1, "exactly one optimistic bubble removed");
  assert.equal(next[0].id, "opt-new", "kept the newer pending bubble (rapid-double-send case)");
});

test("removeMatchingOptimistic ignores failed entries (failures must stay retryable)", () => {
  const prev = [opt({ id: "opt-fail", status: "failed", message: "ok" })];
  const next = removeMatchingOptimistic(prev, msg({ id: "srv", message: "ok" }), "user-1");
  assert.equal(next, prev, "failed entry not consumed by reconciliation");
});

test("removeMatchingOptimistic requires isInternal to match (reply vs internal note are distinct)", () => {
  const prev = [opt({ message: "ok", isInternal: true })];
  const next = removeMatchingOptimistic(
    prev,
    msg({ message: "ok", isInternal: false }),
    "user-1",
  );
  assert.equal(next, prev, "reply broadcast must not eat an internal-note optimistic");
});

test("removeMatchingOptimistic does nothing when sender isn't current user", () => {
  const prev = [opt()];
  const next = removeMatchingOptimistic(prev, msg({ senderId: "someone-else" }), "user-1");
  assert.equal(next, prev);
});

test("removeMatchingOptimistic does nothing when currentUserId is null (no session)", () => {
  const prev = [opt()];
  const next = removeMatchingOptimistic(prev, msg(), null);
  assert.equal(next, prev);
});

test("removeMatchingOptimistic returns prev unchanged when nothing matches", () => {
  const prev = [opt({ message: "hello" })];
  const next = removeMatchingOptimistic(prev, msg({ message: "different text" }), "user-1");
  assert.equal(next, prev);
});

// --- Integration: WS-before-POST sequence ---------------------------------
// Simulates the full own-send timeline that ticket-detail.tsx runs through
// when the server's WebSocket broadcast races ahead of the sender's own
// POST .then(). The user must see exactly ONE bubble at every step — never
// a brief duplicate, and never a vanished message.

test("integration: WS arrives before POST response → exactly one rendered bubble at every step", () => {
  const CURRENT_USER = "user-1";

  // State as it lives in the React component.
  let cache: ReconcileMessage[] | undefined = []; // server messages cache (TanStack Query)
  let optimistic: ReconcileOptimistic[] = []; // local pending placeholders

  const visibleBubbles = (): { source: "server" | "optimistic"; key: string; text: string }[] => {
    // Mirrors how ticket-detail renders: real cache rows first, then
    // optimistic rows that haven't been reconciled away yet.
    const serverRows = (cache ?? []).map((m) => ({
      source: "server" as const,
      key: m.id,
      text: m.message,
    }));
    const optRows = optimistic.map((m) => ({
      source: "optimistic" as const,
      key: m.id,
      text: m.message,
    }));
    return [...serverRows, ...optRows];
  };

  // 1. User taps Send → optimistic placeholder appears immediately.
  const tempId = "optimistic-abc";
  optimistic = [
    ...optimistic,
    {
      id: tempId,
      senderId: CURRENT_USER,
      message: "hello world",
      isInternal: false,
      status: "sending",
    },
  ];
  assert.deepEqual(
    visibleBubbles().map((b) => ({ source: b.source, text: b.text })),
    [{ source: "optimistic", text: "hello world" }],
    "after Send tap: exactly one optimistic bubble",
  );

  // 2. WebSocket broadcast lands BEFORE the POST .then() resolves.
  const wsIncoming: ReconcileMessage = {
    id: "srv-real",
    senderId: CURRENT_USER,
    message: "hello world",
    isInternal: false,
  };
  cache = mergeIncomingMessageIntoCache(cache, wsIncoming);
  optimistic = removeMatchingOptimistic(optimistic, wsIncoming, CURRENT_USER);

  // The critical invariant: still EXACTLY one bubble (now the real one),
  // never two side-by-side and never zero.
  assert.deepEqual(
    visibleBubbles().map((b) => ({ source: b.source, text: b.text })),
    [{ source: "server", text: "hello world" }],
    "WS-before-POST: optimistic dropped, real bubble visible — exactly one",
  );

  // 3. POST .then() eventually resolves and tries to clean up its tempId.
  //    The optimistic list no longer holds it (the WS already cleared it),
  //    so this is a no-op filter — must NOT remove the real bubble or
  //    cause the count to flip.
  optimistic = optimistic.filter((m) => m.id !== tempId);
  assert.deepEqual(
    visibleBubbles().map((b) => ({ source: b.source, text: b.text })),
    [{ source: "server", text: "hello world" }],
    "POST .then() after WS: still exactly one bubble",
  );

  // 4. Server occasionally broadcasts the same message twice (internal
  //    notes / admin-only fan-out path). Must stay at one bubble.
  cache = mergeIncomingMessageIntoCache(cache, wsIncoming);
  assert.equal(cache.length, 1, "duplicate WS delivery dedup'd by id");
  assert.equal(
    visibleBubbles().length,
    1,
    "duplicate WS delivery: still exactly one bubble",
  );
});

test("integration: rapid double-send 'ok'/'ok' keeps the second bubble pending when only one WS lands", () => {
  const CURRENT_USER = "user-1";
  let optimistic: ReconcileOptimistic[] = [
    { id: "opt-1", senderId: CURRENT_USER, message: "ok", isInternal: false, status: "sending" },
    { id: "opt-2", senderId: CURRENT_USER, message: "ok", isInternal: false, status: "sending" },
  ];
  let cache: ReconcileMessage[] | undefined = [];

  const wsFirst: ReconcileMessage = {
    id: "srv-1",
    senderId: CURRENT_USER,
    message: "ok",
    isInternal: false,
  };
  cache = mergeIncomingMessageIntoCache(cache, wsFirst);
  optimistic = removeMatchingOptimistic(optimistic, wsFirst, CURRENT_USER);

  assert.equal(cache.length, 1);
  assert.equal(optimistic.length, 1, "only the oldest pending bubble was consumed");
  assert.equal(optimistic[0].id, "opt-2", "the second send stays retryable");
});
