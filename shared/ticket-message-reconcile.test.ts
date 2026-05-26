import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendOptimistic,
  markOptimisticSending,
  markOptimisticFailed,
  removeOptimisticById,
  removeMatchingOptimistic,
  mergeIncomingMessageIntoCache,
  type ReconcileOptimistic,
  type ReconcileMessage,
} from "./ticket-message-reconcile";

// ---------------------------------------------------------------------------
// Simulated `doSendMessage` driver
//
// Mirrors the state transitions inside ticket-detail.tsx's `doSendMessage`
// (append/replace -> POST -> success removes / failure marks failed) without
// pulling React in. The `fetchImpl` parameter lets each test decide whether
// the POST resolves or rejects, mirroring a flaky network.
// ---------------------------------------------------------------------------

interface TestOptimistic extends ReconcileOptimistic {}

function makeDriver(
  initialState: TestOptimistic[],
  fetchImpl: (call: number) => Promise<void>,
) {
  let state = initialState;
  let callCount = 0;
  const transitions: Array<TestOptimistic[]> = [state];

  function set(updater: (prev: TestOptimistic[]) => TestOptimistic[]) {
    state = updater(state);
    transitions.push(state);
  }

  async function doSend(
    msg: { id?: string; senderId: string; message: string; isInternal?: boolean },
  ): Promise<{ id: string; outcome: "success" | "failure" }> {
    const tempId = msg.id ?? `temp-${callCount + 1}`;
    if (!msg.id) {
      set((prev) =>
        appendOptimistic(prev, {
          id: tempId,
          senderId: msg.senderId,
          message: msg.message,
          isInternal: msg.isInternal ?? false,
          status: "sending",
        }),
      );
    } else {
      set((prev) => markOptimisticSending(prev, tempId));
    }
    const thisCall = callCount++;
    try {
      await fetchImpl(thisCall);
      set((prev) => removeOptimisticById(prev, tempId));
      return { id: tempId, outcome: "success" };
    } catch {
      set((prev) => markOptimisticFailed(prev, tempId));
      return { id: tempId, outcome: "failure" };
    }
  }

  return {
    doSend,
    get state() {
      return state;
    },
    deliverBroadcast(incoming: ReconcileMessage, currentUserId: string | null) {
      set((prev) => removeMatchingOptimistic(prev, incoming, currentUserId));
    },
    transitions,
  };
}

// ---------------------------------------------------------------------------
// Pure helper unit tests
// ---------------------------------------------------------------------------

test("appendOptimistic adds a row with sending status", () => {
  const next = appendOptimistic<TestOptimistic>([], {
    id: "t1",
    senderId: "u1",
    message: "hi",
    status: "sending",
  });
  assert.equal(next.length, 1);
  assert.equal(next[0].status, "sending");
});

test("markOptimisticSending flips a failed row back to sending in place", () => {
  const prev: TestOptimistic[] = [
    { id: "a", senderId: "u1", message: "first", status: "failed" },
    { id: "b", senderId: "u1", message: "second", status: "sending" },
  ];
  const next = markOptimisticSending(prev, "a");
  assert.equal(next[0].status, "sending");
  assert.equal(next[0].id, "a");
  assert.equal(next.length, 2);
  assert.equal(next[1], prev[1]); // untouched ref
});

test("markOptimisticSending is a no-op (referentially) when already sending", () => {
  const prev: TestOptimistic[] = [
    { id: "a", senderId: "u1", message: "first", status: "sending" },
  ];
  const next = markOptimisticSending(prev, "a");
  assert.equal(next, prev);
});

test("markOptimisticSending does NOT insert when id is unknown", () => {
  const prev: TestOptimistic[] = [
    { id: "a", senderId: "u1", message: "first", status: "sending" },
  ];
  const next = markOptimisticSending(prev, "ghost");
  assert.equal(next, prev);
  assert.equal(next.length, 1);
});

test("markOptimisticFailed flips sending to failed exactly once", () => {
  const prev: TestOptimistic[] = [
    { id: "a", senderId: "u1", message: "first", status: "sending" },
  ];
  const next = markOptimisticFailed(prev, "a");
  assert.equal(next[0].status, "failed");
  const again = markOptimisticFailed(next, "a");
  assert.equal(again, next); // already failed -> same ref
});

test("removeOptimisticById removes the matching row", () => {
  const prev: TestOptimistic[] = [
    { id: "a", senderId: "u1", message: "first", status: "sending" },
    { id: "b", senderId: "u1", message: "second", status: "sending" },
  ];
  assert.deepEqual(
    removeOptimisticById(prev, "a").map((m) => m.id),
    ["b"],
  );
});

// ---------------------------------------------------------------------------
// End-to-end fail -> retry flow
// ---------------------------------------------------------------------------

test("doSendMessage flips bubble to failed when POST rejects", async () => {
  const driver = makeDriver([], () => Promise.reject(new Error("network")));
  const { id, outcome } = await driver.doSend({ senderId: "u1", message: "hi" });
  assert.equal(outcome, "failure");
  assert.equal(driver.state.length, 1);
  assert.equal(driver.state[0].id, id);
  assert.equal(driver.state[0].status, "failed");
});

test("retry flips failed -> sending exactly once, then success removes it", async () => {
  let callsSeen = 0;
  const driver = makeDriver([], (call) => {
    callsSeen = call + 1;
    // First send fails, retry succeeds.
    return call === 0 ? Promise.reject(new Error("network")) : Promise.resolve();
  });

  const { id } = await driver.doSend({ senderId: "u1", message: "hello" });
  assert.equal(driver.state[0].status, "failed");

  // Retry uses the same tempId.
  const sendingSnapshotsBefore = driver.transitions.filter(
    (s) => s.some((m) => m.id === id && m.status === "sending"),
  ).length;

  const retryResult = await driver.doSend({ id, senderId: "u1", message: "hello" });
  assert.equal(retryResult.outcome, "success");
  assert.equal(callsSeen, 2, "POST fired twice (original + retry)");

  const sendingSnapshotsAfter = driver.transitions.filter(
    (s) => s.some((m) => m.id === id && m.status === "sending"),
  ).length;
  assert.equal(
    sendingSnapshotsAfter - sendingSnapshotsBefore,
    1,
    "retry flips back to 'sending' exactly once",
  );

  assert.equal(driver.state.length, 0, "successful retry removes the row");
});

test("retry that fails again leaves a single failed row (no duplicate optimistic)", async () => {
  const driver = makeDriver([], () => Promise.reject(new Error("network")));
  const { id } = await driver.doSend({ senderId: "u1", message: "again" });
  assert.equal(driver.state.length, 1);

  await driver.doSend({ id, senderId: "u1", message: "again" });
  assert.equal(driver.state.length, 1, "retry must reuse the same row, never duplicate");
  assert.equal(driver.state[0].status, "failed");
});

// ---------------------------------------------------------------------------
// WS broadcast vs failed/retried optimistic interaction
// ---------------------------------------------------------------------------

test("WS broadcast after retry success removes the matching pending row only", async () => {
  // Two pending sends, one already failed (awaiting user Retry), one still sending.
  const initial: TestOptimistic[] = [
    { id: "fail-1", senderId: "u1", message: "hello", status: "failed" },
    { id: "send-1", senderId: "u1", message: "hello", status: "sending" },
  ];
  const driver = makeDriver(initial, () => Promise.resolve());

  // A broadcast for the "sending" copy lands — it must consume the sending row,
  // never the failed row (which would silently swallow a retryable failure).
  const incoming: ReconcileMessage = {
    id: "server-1",
    senderId: "u1",
    message: "hello",
    isInternal: false,
  };
  driver.deliverBroadcast(incoming, "u1");

  assert.equal(driver.state.length, 1);
  assert.equal(driver.state[0].id, "fail-1");
  assert.equal(driver.state[0].status, "failed");
});

test("WS broadcast does NOT consume a failed row when retry hasn't fired", () => {
  const initial: TestOptimistic[] = [
    { id: "fail-1", senderId: "u1", message: "hello", status: "failed" },
  ];
  const driver = makeDriver(initial, () => Promise.resolve());
  const incoming: ReconcileMessage = {
    id: "server-1",
    senderId: "u1",
    message: "hello",
    isInternal: false,
  };
  driver.deliverBroadcast(incoming, "u1");
  assert.deepEqual(driver.state.map((m) => m.id), ["fail-1"]);
  assert.equal(driver.state[0].status, "failed");
});

test("WS broadcast after retry has flipped status to 'sending' DOES consume the row", async () => {
  // Set up a row currently in 'failed', then start a retry whose POST never
  // resolves so we can observe the in-flight 'sending' state when the WS
  // broadcast arrives.
  let resolveFetch: (() => void) | null = null;
  const driver = makeDriver(
    [{ id: "tx", senderId: "u1", message: "hello", status: "failed" }],
    () =>
      new Promise<void>((resolve) => {
        resolveFetch = resolve;
      }),
  );

  // Fire the retry but don't await it.
  const retryPromise = driver.doSend({ id: "tx", senderId: "u1", message: "hello" });

  // Sanity: status flipped back to sending.
  assert.equal(driver.state[0].status, "sending");

  driver.deliverBroadcast(
    { id: "srv", senderId: "u1", message: "hello", isInternal: false },
    "u1",
  );
  assert.equal(driver.state.length, 0, "in-flight retry row is consumed by its echo");

  // Let the POST settle so the promise doesn't dangle.
  resolveFetch!();
  await retryPromise;
  // After success the row is already gone; removeOptimisticById is a no-op.
  assert.equal(driver.state.length, 0);
});

test("mergeIncomingMessageIntoCache + reconcile interplay is idempotent on double broadcast", () => {
  const initial: TestOptimistic[] = [
    { id: "send-1", senderId: "u1", message: "hi", status: "sending" },
  ];
  const incoming = { id: "srv-1", senderId: "u1", message: "hi", isInternal: false };

  const cache1 = mergeIncomingMessageIntoCache(undefined, incoming);
  const optimistic1 = removeMatchingOptimistic(initial, incoming, "u1");
  assert.equal(optimistic1.length, 0);

  // Second broadcast (e.g. admin-only fan-out path) — must be a no-op.
  const cache2 = mergeIncomingMessageIntoCache(cache1, incoming);
  const optimistic2 = removeMatchingOptimistic(optimistic1, incoming, "u1");
  assert.equal(cache2.length, 1);
  assert.equal(optimistic2.length, 0);
  assert.equal(cache2, cache1, "dedup short-circuits to same ref");
});
