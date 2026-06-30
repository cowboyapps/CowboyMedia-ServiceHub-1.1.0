import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getQueryFn,
  TimeoutError,
  DEFAULT_QUERY_TIMEOUT_MS,
} from "@/lib/queryClient";

// Regression guard for "pages spin forever when data won't load": every read
// goes through getQueryFn, which must abort a never-resolving fetch so the bound
// `query.isLoading` clears and React Query's `isError` path renders (retry UI /
// message) instead of an endless loading skeleton.

const realFetch = globalThis.fetch;

function stubFetch(fn: typeof globalThis.fetch) {
  globalThis.fetch = fn;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function runQueryFn(
  queryKey: readonly unknown[],
  opts?: { timeoutMs?: number | null },
) {
  const fn = getQueryFn({ on401: "throw", timeoutMs: opts?.timeoutMs });
  // React Query passes a context object; we only need queryKey here.
  return (fn as any)({ queryKey });
}

test("getQueryFn rejects with TimeoutError when the connection never responds", async () => {
  // A fetch that only ever settles when its abort signal fires — i.e. a dead
  // connection where bytes never flow back.
  stubFetch(((_url: any, init: any) =>
    new Promise((_resolve, reject) => {
      const signal: AbortSignal | undefined = init?.signal;
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as typeof globalThis.fetch);
  try {
    await assert.rejects(
      runQueryFn(["/api/anything"], { timeoutMs: 20 }),
      (err: unknown) => err instanceof TimeoutError,
    );
  } finally {
    restoreFetch();
  }
});

test("getQueryFn attaches an abort signal to the read fetch", async () => {
  let sawSignal = false;
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    await runQueryFn(["/api/anything"]);
    assert.equal(sawSignal, true, "read fetch should attach an abort signal");
    assert.equal(DEFAULT_QUERY_TIMEOUT_MS, 30_000);
  } finally {
    restoreFetch();
  }
});

test("getQueryFn resolves normally for a slow-but-alive response without a TimeoutError or leaked timer", async () => {
  // Spy on the timer pair so we can prove the abort timer is cleared once the
  // (slow but genuine) response lands — i.e. no stray timer survives to fire a
  // spurious abort/TimeoutError on a user with a legitimately slow network.
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const liveTimers = new Set<unknown>();
  globalThis.setTimeout = ((handler: any, ms?: any, ...args: any[]) => {
    const id = realSetTimeout(handler, ms, ...args);
    liveTimers.add(id);
    return id;
  }) as typeof globalThis.setTimeout;
  globalThis.clearTimeout = ((id?: any) => {
    liveTimers.delete(id);
    return realClearTimeout(id);
  }) as typeof globalThis.clearTimeout;

  // A fetch that resolves well before the (generous) deadline — bytes flow, just
  // slowly. It also asserts the abort signal hasn't fired by the time it settles.
  const payload = { ok: true, items: [1, 2, 3] };
  let abortedDuringFetch = false;
  stubFetch(((_url: any, init: any) =>
    new Promise((resolve) => {
      const signal: AbortSignal | undefined = init?.signal;
      realSetTimeout(() => {
        abortedDuringFetch = signal?.aborted ?? false;
        resolve(new Response(JSON.stringify(payload), { status: 200 }));
      }, 20);
    })) as typeof globalThis.fetch);

  try {
    // Deadline comfortably larger than the 20ms response delay.
    const result = await runQueryFn(["/api/anything"], { timeoutMs: 200 });
    assert.deepEqual(result, payload, "should return the parsed JSON body");
    assert.equal(
      abortedDuringFetch,
      false,
      "the abort signal must not fire for a response that beats the deadline",
    );
    assert.equal(
      liveTimers.size,
      0,
      "the abort timer must be cleared once the response resolves (no leaked timer)",
    );

    // Wait past the original deadline to prove no stray timer fires a late abort.
    await new Promise((r) => realSetTimeout(r, 250));
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    restoreFetch();
  }
});

test("getQueryFn forwards React Query's context signal so unmount/refetch aborts the in-flight fetch", async () => {
  // React Query passes an AbortSignal that fires on unmount/refetch; getQueryFn
  // must forward it to the fetch so the in-flight read is cancelled. This surfaces
  // as the underlying AbortError (not a TimeoutError — the deadline never fired).
  const external = new AbortController();
  stubFetch(((_url: any, init: any) =>
    new Promise((_resolve, reject) => {
      const signal: AbortSignal | undefined = init?.signal;
      signal?.addEventListener("abort", () => {
        const err = new Error("aborted");
        err.name = "AbortError";
        reject(err);
      });
    })) as typeof globalThis.fetch);

  try {
    const fn = getQueryFn({ on401: "throw" });
    const promise = (fn as any)({
      queryKey: ["/api/anything"],
      signal: external.signal,
    });
    // Simulate React Query cancelling the query (component unmounted / refetch).
    external.abort();
    await assert.rejects(
      promise,
      (err: unknown) =>
        err instanceof Error &&
        err.name === "AbortError" &&
        !(err instanceof TimeoutError),
    );
  } finally {
    restoreFetch();
  }
});

test("getQueryFn returns null on 401 when on401 is returnNull", async () => {
  stubFetch((() =>
    Promise.resolve(new Response("nope", { status: 401 }))) as typeof globalThis.fetch);
  try {
    const fn = getQueryFn({ on401: "returnNull" });
    const result = await (fn as any)({ queryKey: ["/api/me"] });
    assert.equal(result, null);
  } finally {
    restoreFetch();
  }
});
