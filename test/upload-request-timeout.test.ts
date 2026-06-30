import { test } from "node:test";
import assert from "node:assert/strict";
import {
  uploadRequest,
  TimeoutError,
  DEFAULT_UPLOAD_TIMEOUT_MS,
} from "@/lib/queryClient";

// Regression guard for "file uploads hang forever on a dead connection": every
// raw multipart upload now goes through uploadRequest, which applies the same
// client-side abort timeout as reads/writes — just a more generous one. A
// slow-but-alive upload (bytes flow up, just slowly) must resolve normally with
// no spurious TimeoutError and no leaked abort timer, a truly dead connection
// must surface a TimeoutError instead of an infinite spinner, and the timeoutMs
// opt-out (0/null) must skip the AbortController entirely while still resolving.

const realFetch = globalThis.fetch;

function stubFetch(fn: typeof globalThis.fetch) {
  globalThis.fetch = fn;
}

function restoreFetch() {
  globalThis.fetch = realFetch;
}

function sampleForm() {
  const fd = new FormData();
  fd.append("image", "x");
  return fd;
}

test("uploadRequest resolves normally for a slow-but-alive upload without a TimeoutError or leaked timer", async () => {
  // Spy on the timer pair so we can prove the abort timer is cleared once the
  // (slow but genuine) upload lands — i.e. no stray timer survives to fire a
  // spurious abort/TimeoutError on a user with a legitimately slow upload.
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

  // A fetch that resolves well before the (generous) deadline — a large upload
  // that finishes slowly. It asserts the abort signal hasn't fired by the time
  // it settles, and that the multipart body is forwarded as FormData.
  let abortedDuringUpload = false;
  let sawFormData = false;
  stubFetch(((_url: any, init: any) =>
    new Promise((resolve) => {
      const signal: AbortSignal | undefined = init?.signal;
      sawFormData = init?.body instanceof FormData;
      realSetTimeout(() => {
        abortedDuringUpload = signal?.aborted ?? false;
        resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }, 20);
    })) as typeof globalThis.fetch);

  try {
    // Deadline comfortably larger than the 20ms upload delay.
    const res = await uploadRequest("POST", "/api/upload", sampleForm(), {
      timeoutMs: 200,
    });
    assert.ok(res instanceof Response, "should return the Response");
    assert.equal(res.status, 200);
    assert.equal(sawFormData, true, "the multipart body must be sent as FormData");
    assert.equal(
      abortedDuringUpload,
      false,
      "the abort signal must not fire for an upload that beats the deadline",
    );
    assert.equal(
      liveTimers.size,
      0,
      "the abort timer must be cleared once the upload resolves (no leaked timer)",
    );

    // Wait past the original deadline to prove no stray timer fires a late abort.
    await new Promise((r) => realSetTimeout(r, 250));
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    restoreFetch();
  }
});

test("uploadRequest rejects with TimeoutError when the connection never responds", async () => {
  // A fetch that only ever settles when its abort signal fires — i.e. a dead
  // connection where the upload never completes and no bytes flow back.
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
      uploadRequest("POST", "/api/upload", sampleForm(), { timeoutMs: 20 }),
      (err: unknown) => err instanceof TimeoutError,
    );
  } finally {
    restoreFetch();
  }
});

test("uploadRequest opt-out (timeoutMs: 0) creates no AbortController and still resolves", async () => {
  // Prove the opt-out path makes no timer and attaches no abort signal, yet the
  // upload still resolves normally — so a deliberately long-running upload is
  // never cut off by the default deadline.
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
    const res = await uploadRequest("POST", "/api/upload", sampleForm(), {
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

test("uploadRequest opt-out (timeoutMs: null) creates no AbortController and still resolves", async () => {
  let sawSignal: unknown = "unset";
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    const res = await uploadRequest("POST", "/api/upload", sampleForm(), {
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

test("uploadRequest attaches an abort signal under the default (generous) timeout", async () => {
  let sawSignal = false;
  stubFetch(((_url: any, init: any) => {
    sawSignal = init?.signal instanceof AbortSignal;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof globalThis.fetch);
  try {
    await uploadRequest("POST", "/api/upload", sampleForm());
    assert.equal(sawSignal, true, "upload fetch should attach an abort signal");
    // Generous default so a legitimately slow large upload is never cut off,
    // but still finite so a dead connection can't hang forever.
    assert.equal(DEFAULT_UPLOAD_TIMEOUT_MS, 120_000);
    assert.ok(
      DEFAULT_UPLOAD_TIMEOUT_MS > 30_000,
      "upload deadline must be more generous than the JSON-write default",
    );
  } finally {
    restoreFetch();
  }
});
