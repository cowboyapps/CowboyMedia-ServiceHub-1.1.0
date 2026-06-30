import { test } from "node:test";
import assert from "node:assert/strict";
import {
  apiRequest,
  TimeoutError,
  DEFAULT_TIMEOUT_MS,
} from "@/lib/queryClient";

// Regression guard for "buttons hang forever on a dead connection": every
// mutation goes through apiRequest, which must abort a never-resolving fetch so
// the bound `mutation.isPending` clears and the control re-enables.

const realFetch = globalThis.fetch;

function stubFetch(fn: typeof globalThis.fetch) {
  globalThis.fetch = fn;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

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
      apiRequest("POST", "/api/anything", { foo: 1 }, { timeoutMs: 20 }),
      (err: unknown) => err instanceof TimeoutError,
    );
  } finally {
    restoreFetch();
  }
});

test("apiRequest applies a default timeout when none is provided", async () => {
  let sawSignal = false;
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    await apiRequest("POST", "/api/anything", { foo: 1 });
    assert.equal(sawSignal, true, "default timeout should attach an abort signal");
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  } finally {
    restoreFetch();
  }
});

test("apiRequest with timeoutMs:0 opts out of the timeout (no abort signal)", async () => {
  let signalSeen: AbortSignal | undefined;
  stubFetch(((_url: any, init: any) => {
    signalSeen = init?.signal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    await apiRequest("POST", "/api/anything", undefined, { timeoutMs: 0 });
    assert.equal(signalSeen, undefined, "timeoutMs:0 should not attach a signal");
  } finally {
    restoreFetch();
  }
});

test("TimeoutError carries a customer-friendly default message", () => {
  const err = new TimeoutError();
  assert.match(err.message, /timed out/i);
  assert.match(err.message, /try again/i);
});
