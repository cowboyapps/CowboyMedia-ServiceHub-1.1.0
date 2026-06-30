import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiRequest,
  TimeoutError,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/queryClient";

// Regression guard for "saves/submits get cut off too early": every write goes
// through apiRequest, which applies the same client-side abort timeout as reads.
// A slow-but-alive response (bytes flow, just slowly) must resolve normally with
// no spurious TimeoutError and no leaked abort timer, and the timeoutMs opt-out
// (0/null) must skip the AbortController entirely while still resolving.

const realFetch = globalThis.fetch;

function stubFetch(fn: typeof globalThis.fetch) {
  globalThis.fetch = fn;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

test("apiRequest resolves normally for a slow-but-alive response without a TimeoutError or leaked timer", async () => {
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
  let abortedDuringFetch = false;
  stubFetch(((_url: any, init: any) =>
    new Promise((resolve) => {
      const signal: AbortSignal | undefined = init?.signal;
      realSetTimeout(() => {
        abortedDuringFetch = signal?.aborted ?? false;
        resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }, 20);
    })) as typeof globalThis.fetch);

  try {
    // Deadline comfortably larger than the 20ms response delay.
    const res = await apiRequest("POST", "/api/anything", { a: 1 }, {
      timeoutMs: 200,
    });
    assert.ok(res instanceof Response, "should return the Response");
    assert.equal(res.status, 200);
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

test("apiRequest rejects with TimeoutError when the connection never responds", async () => {
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
      apiRequest("POST", "/api/anything", { a: 1 }, { timeoutMs: 20 }),
      (err: unknown) => err instanceof TimeoutError,
    );
  } finally {
    restoreFetch();
  }
});

test("apiRequest opt-out (timeoutMs: 0) creates no AbortController and still resolves", async () => {
  // Prove the opt-out path makes no timer and attaches no abort signal, yet the
  // request still resolves normally — so a deliberately long-running write
  // (e.g. AI generation) is never cut off by the default deadline.
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

  let sawSignal: unknown = "unset";
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);

  try {
    const res = await apiRequest("POST", "/api/anything", { a: 1 }, {
      timeoutMs: 0,
    });
    assert.ok(res instanceof Response, "should still resolve with the Response");
    assert.equal(res.status, 200);
    assert.equal(
      sawSignal,
      undefined,
      "no AbortController should be created when timeoutMs is 0 (signal undefined)",
    );
    assert.equal(
      liveTimers.size,
      0,
      "no abort timer should be scheduled when the timeout is opted out",
    );
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    restoreFetch();
  }
});

test("apiRequest opt-out (timeoutMs: null) creates no AbortController and still resolves", async () => {
  let sawSignal: unknown = "unset";
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    const res = await apiRequest("POST", "/api/anything", { a: 1 }, {
      timeoutMs: null,
    });
    assert.ok(res instanceof Response);
    assert.equal(res.status, 200);
    assert.equal(
      sawSignal,
      undefined,
      "no AbortController should be created when timeoutMs is null (signal undefined)",
    );
  } finally {
    restoreFetch();
  }
});

test("apiRequest attaches an abort signal under the default timeout", async () => {
  let sawSignal = false;
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    await apiRequest("POST", "/api/anything", { a: 1 });
    assert.equal(sawSignal, true, "write fetch should attach an abort signal");
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  } finally {
    restoreFetch();
  }
});
