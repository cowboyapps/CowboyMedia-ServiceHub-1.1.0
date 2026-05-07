import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

interface SWModule {
  isHashedAsset: (url: URL) => boolean;
  isNavigationRequest: (req: { mode?: string; method: string; headers: { get: (k: string) => string | null } }) => boolean;
  handleHashedAsset: (req: Request) => Promise<Response>;
  __postedMessages: Array<{ type: string; reason?: string }>;
  __setFetch: (fn: typeof fetch) => void;
  __resetMessages: () => void;
}

function loadServiceWorker(): SWModule {
  const src = readFileSync(join(process.cwd(), "client/public/sw.js"), "utf8");

  const posted: Array<{ type: string; reason?: string }> = [];
  let fetchImpl: typeof fetch = async () => new Response("", { status: 200 });

  const fakeCache = {
    put: async () => {},
    add: async () => {},
    match: async () => undefined,
  };
  const cachesStub = {
    open: async () => fakeCache,
    match: async () => undefined,
    keys: async () => [],
    delete: async () => true,
  };

  const self: any = {
    addEventListener: () => {},
    skipWaiting: () => {},
    location: { origin: "https://example.test" },
    clients: {
      matchAll: async () => [
        {
          postMessage: (m: { type: string; reason?: string }) => posted.push(m),
          visibilityState: "visible",
          url: "https://example.test/",
        },
      ],
      claim: async () => {},
      openWindow: async () => null,
    },
    registration: {
      showNotification: async () => {},
      getNotifications: async () => [],
    },
    navigator: {},
  };

  const ctx: any = {
    self,
    caches: cachesStub,
    fetch: (...args: Parameters<typeof fetch>) => fetchImpl(...args),
    URL,
    Response,
    Request,
    Promise,
    setTimeout,
    clearTimeout,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  return {
    isHashedAsset: ctx.isHashedAsset,
    isNavigationRequest: ctx.isNavigationRequest,
    handleHashedAsset: ctx.handleHashedAsset,
    __postedMessages: posted,
    __setFetch: (fn) => {
      fetchImpl = fn;
    },
    __resetMessages: () => {
      posted.length = 0;
    },
  };
}

const sw = loadServiceWorker();

test("isHashedAsset matches Vite-style hashed bundles under /assets/", () => {
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/index-AbCdEf12.js")), true);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/main-DEADBEEF99.css")), true);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/font-9aBcDeF1.woff2")), true);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/photo-x12345y.png")), true);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/index-AbCdEf12.js?v=2")), true);
});

test("isHashedAsset rejects non-hashed or non-/assets/ paths", () => {
  assert.equal(sw.isHashedAsset(new URL("https://x.test/")), false);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/index.html")), false);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/icons/icon-192.png")), false);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/logo.png")), false);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/short-abc.js")), false);
  assert.equal(sw.isHashedAsset(new URL("https://x.test/assets/index-AbCdEf12.txt")), false);
});

test("isNavigationRequest detects mode=navigate", () => {
  const req = { mode: "navigate", method: "GET", headers: { get: () => null } };
  assert.equal(sw.isNavigationRequest(req), true);
});

test("isNavigationRequest detects HTML accept header", () => {
  const req = {
    method: "GET",
    headers: { get: (k: string) => (k === "accept" ? "text/html,application/xhtml+xml" : null) },
  };
  assert.equal(sw.isNavigationRequest(req), true);
});

test("isNavigationRequest rejects POST and non-HTML GETs", () => {
  assert.equal(
    sw.isNavigationRequest({ method: "POST", headers: { get: () => "text/html" } }),
    false,
  );
  assert.equal(
    sw.isNavigationRequest({ method: "GET", headers: { get: () => "application/json" } }),
    false,
  );
});

test("handleHashedAsset posts SW_RELOAD_REQUIRED when asset 404s (deploy mismatch)", async () => {
  sw.__resetMessages();
  sw.__setFetch(async () => new Response("", { status: 404 }));
  const res = await sw.handleHashedAsset(
    new Request("https://example.test/assets/index-AbCdEf12.js"),
  );
  assert.equal(res.status, 404);
  // Allow the fire-and-forget notifyClients to resolve.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sw.__postedMessages.length, 1);
  assert.equal(sw.__postedMessages[0].type, "SW_RELOAD_REQUIRED");
  assert.equal(sw.__postedMessages[0].reason, "asset-404");
});

test("handleHashedAsset does NOT post a reload message on a healthy 200", async () => {
  sw.__resetMessages();
  sw.__setFetch(async () => new Response("ok", { status: 200 }));
  const res = await sw.handleHashedAsset(
    new Request("https://example.test/assets/index-AbCdEf12.js"),
  );
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sw.__postedMessages.length, 0);
});

test("handleHashedAsset posts SW_RELOAD_REQUIRED on network failure", async () => {
  sw.__resetMessages();
  sw.__setFetch(async () => {
    throw new Error("network down");
  });
  const res = await sw.handleHashedAsset(
    new Request("https://example.test/assets/index-AbCdEf12.js"),
  );
  assert.equal(res.status, 504);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(sw.__postedMessages.length, 1);
  assert.equal(sw.__postedMessages[0].reason, "asset-network-error");
});
