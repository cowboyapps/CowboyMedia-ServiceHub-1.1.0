import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the in-place cache patching of community chat WS
// events (client/src/pages/community-chat-page.tsx onMessage handler):
//  - `community_message`   → new message is appended to the cached list and
//    renders WITHOUT a refetch of /api/community-chat/messages.
//  - duplicate `community_message` (same id, e.g. reconnect replay or the
//    sender's own POST + broadcast) does NOT render the message twice.
//  - `community_message_edited` → content/editedAt are patched in place and
//    the new text renders without a refetch (and without dropping fields).
// jsdom + fetch-stub harness mirrors test/community-chat-admin-gating.test.ts;
// the controllable WebSocket mock mirrors
// test/community-chat-reconnect-banner.test.ts.
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
  "KeyboardEvent", "InputEvent", "MessageEvent", "NodeFilter", "DOMException",
  "MutationObserver",
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

const URLCtor = window.URL as unknown as { createObjectURL?: () => string; revokeObjectURL?: () => void };
URLCtor.createObjectURL ??= () => "blob:stub";
URLCtor.revokeObjectURL ??= () => {};

// --- Controllable WebSocket mock -------------------------------------------
// Unlike the admin-gating stub (which never fires events), this one records
// every socket so tests can fire `open` and dispatch server messages through
// the page's real `onMessage` handler.
interface MockSocket {
  url: string;
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  fireOpen(): void;
  serverSend(payload: unknown): void;
}

let socketLog: MockSocket[] = [];

class MockWebSocket implements MockSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    socketLog.push(this);
  }
  send(): void {}
  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new window.Event("close"));
  }
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new window.Event("open"));
  }
  serverSend(payload: unknown): void {
    this.onmessage?.(
      new window.MessageEvent("message", { data: JSON.stringify(payload) }),
    );
  }
}
g.WebSocket = MockWebSocket as unknown as typeof WebSocket;
w.WebSocket = MockWebSocket as unknown as typeof WebSocket;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures + fetch stub ---------------------------------------------------
const ISO = "2026-01-01T00:00:00.000Z";

const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com", chatUsername: "casey", chatNotifications: "mentions", chatBanned: false,
};

const SEED_MSG = {
  id: "msg-seed",
  userId: "cust-2",
  chatUsername: "OtherCustomer",
  content: "Seed message already in cache",
  imageUrl: null,
  pollId: null,
  kbArticle: null,
  createdAt: ISO,
  editedAt: null,
  reactions: [],
  isAdmin: false,
};

const INCOMING_MSG = {
  ...SEED_MSG,
  id: "msg-live-1",
  content: "Fresh message arriving over the socket",
  createdAt: "2026-01-01T00:05:00.000Z",
};

// Counts refetches of the messages list — the core assertion of this file is
// that WS patches render WITHOUT bumping this counter past the initial load.
let messagesFetchCount = 0;

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

  if (pathname === "/api/auth/me") return jsonResponse(CUSTOMER_USER);
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/community-chat/messages") {
    messagesFetchCount += 1;
    return jsonResponse([SEED_MSG]);
  }
  if (pathname === "/api/community-chat/participants") return jsonResponse([{ username: "OtherCustomer", isAdmin: false }]);
  return jsonResponse({});
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate. auth.tsx relies on Vite's automatic JSX
// runtime, so React must exist on the global scope too.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
// IMPORTANT: the page's WS onMessage handler patches the *singleton*
// queryClient imported from @/lib/queryClient — a per-test QueryClient would
// never see those patches. Mount with the singleton and reconfigure it for
// jsdom (retry off, gcTime 0 so the process can exit).
const { queryClient, getQueryFn } = await import("../client/src/lib/queryClient");
queryClient.setDefaultOptions({
  queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
  mutations: { retry: false, gcTime: 0 },
});
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const CommunityChatPage = (await import("../client/src/pages/community-chat-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  cleanup: () => void;
  socket: MockSocket;
}

async function mountChat(): Promise<MountResult> {
  socketLog = [];
  messagesFetchCount = 0;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.clear();

  const { hook } = memoryLocation({ path: "/community" });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          {
            hook,
            children: React.createElement(Route, { path: "/community", component: CommunityChatPage }),
          },
        ),
      ),
    );

  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  // The page opens its socket once the authed user resolves. Open it so the
  // page's onMessage handler is live.
  assert.ok(socketLog.length >= 1, "page opened a WebSocket");
  const socket = socketLog[socketLog.length - 1];
  await act(async () => {
    socket.fireOpen();
  });
  await flush();

  assert.equal(messagesFetchCount, 1, "messages list fetched exactly once on load");
  assert.ok(has(`community-message-${SEED_MSG.id}`), "seeded message rendered");

  return {
    socket,
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

function countTestId(id: string): number {
  return window.document.body.querySelectorAll(`[data-testid="${id}"]`).length;
}

function messageText(id: string): string {
  const el = window.document.body.querySelector(`[data-testid="community-message-${id}"]`);
  return el?.textContent ?? "";
}

// ---------------------------------------------------------------------------

test("community_message: new message renders in place without a refetch", async () => {
  const h = await mountChat();
  try {
    await act(async () => {
      h.socket.serverSend({ type: "community_message", message: INCOMING_MSG });
    });
    await flush();

    assert.ok(
      has(`community-message-${INCOMING_MSG.id}`),
      "incoming message renders from the patched cache",
    );
    assert.match(
      messageText(INCOMING_MSG.id),
      /Fresh message arriving over the socket/,
      "incoming message shows its content",
    );
    assert.ok(has(`community-message-${SEED_MSG.id}`), "seeded message is still there");
    assert.equal(
      messagesFetchCount,
      1,
      "no refetch — the cache was patched in place",
    );
  } finally {
    h.cleanup();
  }
});

test("community_message: duplicate event (same id) does not render the message twice", async () => {
  const h = await mountChat();
  try {
    await act(async () => {
      h.socket.serverSend({ type: "community_message", message: INCOMING_MSG });
    });
    await flush();
    // Replay — reconnects can re-deliver, and the sender's own POST handler
    // plus the broadcast can race.
    await act(async () => {
      h.socket.serverSend({ type: "community_message", message: INCOMING_MSG });
    });
    await flush();

    assert.equal(
      countTestId(`community-message-${INCOMING_MSG.id}`),
      1,
      "duplicate community_message is deduped by id",
    );
    assert.equal(messagesFetchCount, 1, "dedup path never refetches either");
  } finally {
    h.cleanup();
  }
});

test("community_message_edited: content patches in place without a refetch and keeps other fields", async () => {
  const h = await mountChat();
  try {
    await act(async () => {
      h.socket.serverSend({
        type: "community_message_edited",
        messageId: SEED_MSG.id,
        content: "Seed message, now edited",
        editedAt: "2026-01-01T00:10:00.000Z",
      });
    });
    await flush();

    const text = messageText(SEED_MSG.id);
    assert.match(text, /Seed message, now edited/, "edited content renders");
    assert.doesNotMatch(
      text,
      /Seed message already in cache/,
      "old content is gone",
    );
    assert.ok(
      has(`label-edited-${SEED_MSG.id}`),
      "(edited) label appears because editedAt was patched in",
    );
    // The patch must not drop fields the row already had — the username is
    // rendered from msg.chatUsername on first-in-run messages.
    assert.match(text, /OtherCustomer/, "sender username survives the patch");
    assert.equal(messagesFetchCount, 1, "no refetch — edit was patched in place");
  } finally {
    h.cleanup();
  }
});

test("community_message_edited: unknown message id falls back to a refetch", async () => {
  const h = await mountChat();
  try {
    await act(async () => {
      h.socket.serverSend({
        type: "community_message_edited",
        messageId: "msg-not-in-cache",
        content: "Edit of an older page",
        editedAt: "2026-01-01T00:10:00.000Z",
      });
    });
    await flush();

    assert.equal(
      messagesFetchCount,
      2,
      "edit of an uncached message invalidates and refetches the list",
    );
  } finally {
    h.cleanup();
  }
});
