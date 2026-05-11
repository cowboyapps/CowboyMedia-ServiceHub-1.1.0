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

interface FakeClient {
  url: string;
  focused?: boolean;
  navigatedTo?: string;
  focus: () => Promise<FakeClient>;
  navigate: (u: string) => Promise<void>;
}

interface NotificationClickHarness {
  fire: (event: {
    action?: string;
    notification: {
      data?: Record<string, unknown>;
      close: () => void;
    };
  }) => Promise<void>;
  fetchCalls: Array<{ url: string; init?: RequestInit }>;
  setFetch: (fn: (url: string, init?: RequestInit) => Promise<Response>) => void;
  setNotifications: (n: unknown[]) => void;
  setClients: (c: FakeClient[]) => void;
  badgeCalls: Array<number | "clear">;
  openedWindows: string[];
}

function loadNotificationClickHandler(): NotificationClickHarness {
  const src = readFileSync(join(process.cwd(), "client/public/sw.js"), "utf8");

  let notificationClickHandler: ((e: any) => void) | null = null;
  let notifications: unknown[] = [];
  let clientsList: FakeClient[] = [];
  const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
  const badgeCalls: Array<number | "clear"> = [];
  const openedWindows: string[] = [];
  let fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = async () =>
    new Response("", { status: 200 });

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
    addEventListener: (type: string, fn: (e: any) => void) => {
      if (type === "notificationclick") notificationClickHandler = fn;
    },
    skipWaiting: () => {},
    location: { origin: "https://example.test" },
    clients: {
      matchAll: async () => clientsList,
      claim: async () => {},
      openWindow: async (url: string) => {
        openedWindows.push(url);
        return null;
      },
    },
    registration: {
      showNotification: async () => {},
      getNotifications: async () => notifications,
    },
    navigator: {
      setAppBadge: (n: number) => {
        badgeCalls.push(n);
        return Promise.resolve();
      },
      clearAppBadge: () => {
        badgeCalls.push("clear");
        return Promise.resolve();
      },
    },
  };

  const ctx: any = {
    self,
    caches: cachesStub,
    fetch: (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, init });
      return fetchImpl(url, init);
    },
    URL,
    Response,
    Request,
    Promise,
    setTimeout,
    clearTimeout,
    encodeURIComponent,
    console,
  };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);

  if (!notificationClickHandler) {
    throw new Error("notificationclick handler not registered");
  }

  return {
    fire: async (event) => {
      const waits: Promise<unknown>[] = [];
      const fullEvent = {
        ...event,
        waitUntil: (p: Promise<unknown>) => waits.push(p),
      };
      notificationClickHandler!(fullEvent);
      await Promise.all(waits);
    },
    fetchCalls,
    setFetch: (fn) => {
      fetchImpl = fn;
    },
    setNotifications: (n) => {
      notifications = n;
    },
    setClients: (c) => {
      clientsList = c;
    },
    badgeCalls,
    openedWindows,
  };
}

test("notificationclick 'mark-read' action calls PATCH /api/notifications/:id/read with credentials and does not open a window", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([{}, {}]); // two remaining
  let closed = false;

  await h.fire({
    action: "mark-read",
    notification: {
      data: { notificationId: "abc 123", url: "/somewhere" },
      close: () => {
        closed = true;
      },
    },
  });

  assert.equal(closed, true);
  assert.equal(h.fetchCalls.length, 1);
  assert.equal(h.fetchCalls[0].url, "/api/notifications/abc%20123/read");
  assert.equal(h.fetchCalls[0].init?.method, "PATCH");
  assert.equal(h.fetchCalls[0].init?.credentials, "include");
  assert.equal(h.openedWindows.length, 0);
  // Badge refreshed from getNotifications -> 2 remaining
  assert.deepEqual(h.badgeCalls, [2]);
});

test("notificationclick 'mark-read' does not focus an existing same-origin client", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([{}]);
  let focused = false;
  let navigatedTo: string | null = null;
  const client: FakeClient = {
    url: "https://example.test/dashboard",
    focus: async () => {
      focused = true;
      return client;
    },
    navigate: async (u: string) => {
      navigatedTo = u;
    },
  };
  h.setClients([client]);

  await h.fire({
    action: "mark-read",
    notification: {
      data: { notificationId: "n1", url: "/somewhere" },
      close: () => {},
    },
  });

  assert.equal(focused, false, "mark-read must not focus the existing client");
  assert.equal(navigatedTo, null, "mark-read must not navigate the existing client");
  assert.equal(h.openedWindows.length, 0);
});

test("notificationclick 'mark-read' clears the badge when no notifications remain", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([]);
  await h.fire({
    action: "mark-read",
    notification: {
      data: { notificationId: "n1" },
      close: () => {},
    },
  });
  assert.deepEqual(h.badgeCalls, ["clear"]);
});

test("notificationclick 'mark-read' still refreshes the badge when fetch rejects", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([{}]);
  h.setFetch(async () => {
    throw new Error("network down");
  });

  await h.fire({
    action: "mark-read",
    notification: {
      data: { notificationId: "n1" },
      close: () => {},
    },
  });

  assert.equal(h.fetchCalls.length, 1);
  assert.deepEqual(h.badgeCalls, [1]);
  assert.equal(h.openedWindows.length, 0);
});

test("notificationclick 'mark-read' still refreshes the badge when fetch returns 500", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([{}, {}, {}]);
  h.setFetch(async () => new Response("boom", { status: 500 }));

  await h.fire({
    action: "mark-read",
    notification: {
      data: { notificationId: "n1" },
      close: () => {},
    },
  });

  assert.deepEqual(h.badgeCalls, [3]);
  assert.equal(h.openedWindows.length, 0);
});

test("notificationclick 'mark-read' falls back to default behavior if notificationId is missing", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([]);
  h.setClients([]);

  await h.fire({
    action: "mark-read",
    notification: {
      data: { url: "/fallback" },
      close: () => {},
    },
  });

  // No PATCH issued — went down default path
  assert.equal(h.fetchCalls.length, 0);
  assert.equal(h.openedWindows.length, 1);
  assert.equal(h.openedWindows[0], "/fallback");
});

test("notificationclick default click focuses and navigates an existing same-origin client", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([{}]);
  let focused = false;
  let navigatedTo: string | null = null;
  const client: FakeClient = {
    url: "https://example.test/dashboard",
    focus: async () => {
      focused = true;
      return client;
    },
    navigate: async (u: string) => {
      navigatedTo = u;
    },
  };
  h.setClients([client]);

  await h.fire({
    notification: {
      data: { notificationId: "n1", url: "/tickets/9" },
      close: () => {},
    },
  });

  assert.equal(h.fetchCalls.length, 0, "default click must not call read endpoint");
  assert.equal(focused, true);
  assert.equal(navigatedTo, "/tickets/9");
  assert.equal(h.openedWindows.length, 0);
  assert.deepEqual(h.badgeCalls, [1]);
});

test("notificationclick default click opens a new window when no same-origin client exists", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([]);
  h.setClients([]);

  await h.fire({
    notification: {
      data: { url: "/news/42" },
      close: () => {},
    },
  });

  assert.equal(h.openedWindows.length, 1);
  assert.equal(h.openedWindows[0], "/news/42");
  assert.deepEqual(h.badgeCalls, ["clear"]);
});

test("notificationclick default click defaults url to '/' when data.url is missing", async () => {
  const h = loadNotificationClickHandler();
  h.setNotifications([]);
  h.setClients([]);

  await h.fire({
    notification: {
      data: {},
      close: () => {},
    },
  });

  assert.equal(h.openedWindows[0], "/");
});
