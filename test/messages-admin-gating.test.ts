import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/chat-composer.test.ts) -------
// This is a real render test: it mounts the unified Messages page as a
// customer and as an admin and asserts the client-side gating of the
// admin-only tools ("New Conversation", the KB-attach composer button,
// delete-thread, and the "Legacy Sent Messages" section). The server already
// enforces these permissions (see server/message-thread-attachments.test.ts);
// this complements that by locking down the UI so a future refactor can't
// silently expose admin controls to customers.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;

type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) {
    g[key] = w[key];
  }
}

const rafImpl: typeof requestAnimationFrame = (cb) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
const cafImpl: typeof cancelAnimationFrame = (id) =>
  clearTimeout(id as unknown as NodeJS.Timeout);
g.requestAnimationFrame = rafImpl;
g.cancelAnimationFrame = cafImpl;
w.requestAnimationFrame = rafImpl;
w.cancelAnimationFrame = cafImpl;

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

class DOMRectStub implements DOMRect {
  x = 0; y = 0; width = 0; height = 0;
  top = 0; right = 0; bottom = 0; left = 0;
  toJSON(): unknown { return this; }
}
g.DOMRect = DOMRectStub;
w.DOMRect = DOMRectStub;

interface PointerCaptureProto {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
  getBoundingClientRect: () => DOMRect;
}
const HEProto = window.HTMLElement.prototype as unknown as PointerCaptureProto;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};
HEProto.getBoundingClientRect = () => new DOMRectStub();

// matchMedia (used by useIsMobile in the thread chat view).
const matchMediaImpl = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
g.matchMedia = matchMediaImpl;
w.matchMedia = matchMediaImpl;

// The thread chat view opens a reconnecting WebSocket on mount. jsdom has no
// WebSocket; a stub that never fires events keeps the socket in "connecting"
// and the component tree stable for the assertions.
class WebSocketStub {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 3; }
  addEventListener(): void {}
  removeEventListener(): void {}
}
g.WebSocket = WebSocketStub;
w.WebSocket = WebSocketStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Test fixtures + a fetch stub that serves the page's queries ----------
const THREAD_ID = "thread-1";
const ISO = "2026-01-01T00:00:00.000Z";

const CUSTOMER_USER = { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" };
const ADMIN_USER = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };

const THREADS = [
  {
    id: THREAD_ID,
    adminId: "admin-1",
    customerId: "cust-1",
    subject: "Need help with billing",
    createdAt: ISO,
    lastMessageAt: ISO,
    unreadCount: 0,
    adminName: "Avery Admin",
    customerName: "Casey Customer",
    lastMessage: { body: "Hi there", senderId: "cust-1", createdAt: ISO },
  },
];

const THREAD = THREADS[0];

const LEGACY_SENT = [
  { id: "sent-1", senderId: "admin-1", recipientId: "cust-1", subject: "Old broadcast", body: "Legacy one-way note", readAt: null, createdAt: ISO },
];

const USERS = [
  { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" },
  { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" },
];

// Set per-test before mounting so /api/auth/me returns the right identity.
let currentUser: typeof CUSTOMER_USER | typeof ADMIN_USER | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];

  if (pathname === "/api/auth/me") {
    return currentUser ? jsonResponse(currentUser) : jsonResponse(null, 401);
  }
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/message-threads") return jsonResponse(THREADS);
  if (pathname === "/api/private-messages") return jsonResponse([]);
  if (pathname === "/api/admin/private-messages/sent") return jsonResponse(LEGACY_SENT);
  if (pathname === "/api/admin/users") return jsonResponse(USERS);
  if (/^\/api\/message-threads\/[^/]+\/messages$/.test(pathname)) return jsonResponse([]);
  if (/^\/api\/message-threads\/[^/]+\/read$/.test(pathname)) return jsonResponse({});
  if (/^\/api\/message-threads\/[^/]+$/.test(pathname)) return jsonResponse(THREAD);

  // Unknown endpoints: succeed quietly so background mutations don't error.
  return jsonResponse({});
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
// messages-page.tsx and auth.tsx rely on Vite's automatic JSX runtime and do
// not import React. Under tsx the JSX compiles to classic `React.createElement`
// calls that resolve `React` from the global scope, so expose it there before
// those modules render.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const MessagesPage = (await import("../client/src/pages/messages-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountMessages(path: string, user: typeof CUSTOMER_USER | typeof ADMIN_USER): Promise<MountResult> {
  currentUser = user;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const { hook } = memoryLocation({ path });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          { hook },
          React.createElement(Route, { path: "/messages", component: MessagesPage }),
          React.createElement(Route, { path: "/messages/:id", component: MessagesPage }),
        ),
      ),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

// --- List view (/messages) -----------------------------------------------

test("customer at /messages never sees the admin-only tools", async () => {
  const h = await mountMessages("/messages", CUSTOMER_USER);
  try {
    // Sanity: the page rendered the customer's own thread.
    assert.ok(has("text-messages-title"), "messages page rendered");
    assert.ok(has(`card-thread-${THREAD_ID}`), "customer sees their thread");

    // Admin-only tools must be absent.
    assert.equal(has("button-new-conversation"), false, "no New Conversation button for customer");
    assert.equal(has(`button-delete-thread-${THREAD_ID}`), false, "no delete-thread button for customer");
    assert.equal(has("card-legacy-sent-sent-1"), false, "no Legacy Sent Messages card for customer");
  } finally {
    h.cleanup();
  }
});

test("admin at /messages sees the admin-only tools", async () => {
  const h = await mountMessages("/messages", ADMIN_USER);
  try {
    assert.ok(has("text-messages-title"), "messages page rendered");
    assert.ok(has("button-new-conversation"), "admin sees New Conversation button");
    assert.ok(has(`button-delete-thread-${THREAD_ID}`), "admin sees delete-thread button");
    assert.ok(has("card-legacy-sent-sent-1"), "admin sees Legacy Sent Messages card");
  } finally {
    h.cleanup();
  }
});

// --- Thread chat view (/messages/:id) ------------------------------------

test("customer in a thread sees the photo attach button but NOT the KB attach button", async () => {
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    assert.ok(has("thread-chat-view"), "thread chat view rendered");
    assert.ok(has("button-attach-thread-image"), "customer composer keeps the photo attach button");
    assert.equal(has("button-attach-thread-kb"), false, "no KB attach button for customer");
  } finally {
    h.cleanup();
  }
});

test("admin in a thread sees both the photo attach and the KB attach buttons", async () => {
  const h = await mountMessages(`/messages/${THREAD_ID}`, ADMIN_USER);
  try {
    assert.ok(has("thread-chat-view"), "thread chat view rendered");
    assert.ok(has("button-attach-thread-image"), "admin composer has the photo attach button");
    assert.ok(has("button-attach-thread-kb"), "admin composer has the KB attach button");
  } finally {
    h.cleanup();
  }
});
