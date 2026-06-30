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
