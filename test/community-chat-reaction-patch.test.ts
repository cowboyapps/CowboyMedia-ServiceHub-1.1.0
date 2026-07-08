import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/community-chat-admin-gating.test.ts)
// This is a real render test: it mounts the Community Chat page, drives
// `community_reaction` WebSocket events through the page's live socket handler
// and asserts the cached message list is patched IN PLACE (no full refetch):
//   - adding a brand-new emoji group
//   - adding a reactor to an existing group
//   - duplicate add event is a no-op (no double-count)
//   - removing a reactor, and dropping the group when the last reactor leaves
//   - a reaction for a message NOT in the cache falls back to an invalidate
//     (observed as a refetch of /api/community-chat/messages).
// A regression here would silently bring back full-list refetches on every
// reaction toggle, or show wrong counts.
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
// Unlike the admin-gating test's inert stub, this one records every instance
// so the test can fire `onmessage` at the page's live socket.
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];
  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  send(): void {}
  close(): void { this.readyState = MockWebSocket.CLOSED; }
  addEventListener(): void {}
  removeEventListener(): void {}
  fireMessage(payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify(payload) });
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

const MSG_A = {
  id: "msg-a",
  userId: "cust-2",
  chatUsername: "OtherCustomer",
  content: "Hello everyone",
  imageUrl: null,
  pollId: null,
  kbArticle: null,
  createdAt: ISO,
  reactions: [] as { emoji: string; userIds: string[] }[],
  isAdmin: false,
};
const MSG_B = {
  id: "msg-b",
  userId: "cust-3",
  chatUsername: "ThirdCustomer",
  content: "Second message",
  imageUrl: null,
  pollId: null,
  kbArticle: null,
  createdAt: ISO,
  reactions: [{ emoji: "🎉", userIds: ["cust-1"] }],
  isAdmin: false,
};

const PARTICIPANTS = [{ username: "OtherCustomer", isAdmin: false }];

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
    messagesFetchCount++;
    return jsonResponse([MSG_A, MSG_B]);
  }
  if (pathname === "/api/community-chat/participants") return jsonResponse(PARTICIPANTS);
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
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
type QueryClientType = import("@tanstack/react-query").QueryClient;
// IMPORTANT: the page's WS handler patches the app-wide singleton queryClient
// (imported from @/lib/queryClient), NOT whatever client the provider supplies.
// The test must therefore mount with that same singleton, or the patches land
// in a client the rendered tree never reads.
const { queryClient: appQueryClient, getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const CommunityChatPage = (await import("../client/src/pages/community-chat-page")).default;

type QC = QueryClientType;

interface ReactionGroup {
  emoji: string;
  userIds: string[];
}
interface CachedMessage {
  id: string;
  reactions?: ReactionGroup[];
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  queryClient: QC;
  socket: MockWebSocket;
  cleanup: () => void;
}

async function mountChat(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = appQueryClient;
  queryClient.setDefaultOptions({
    queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
    mutations: { retry: false, gcTime: 0 },
  });

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

  const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
  assert.ok(socket, "page opened a WebSocket");
  // Open the socket so the page treats it as live.
  await act(async () => {
    socket.readyState = MockWebSocket.OPEN;
    socket.onopen?.({});
  });
  await flush();

  return {
    queryClient,
    socket,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

function getCachedMessages(qc: QC): CachedMessage[] {
  const cached = qc.getQueryData<CachedMessage[]>(["/api/community-chat/messages"]);
  assert.ok(cached, "message list is cached");
  return cached;
}

function reactionsOf(qc: QC, id: string): ReactionGroup[] {
  const msg = getCachedMessages(qc).find((m) => m.id === id);
  assert.ok(msg, `message ${id} in cache`);
  return msg.reactions ?? [];
}

async function fireReaction(
  socket: MockWebSocket,
  payload: { messageId: string; userId: string; emoji: string; added: boolean },
): Promise<void> {
  await act(async () => {
    socket.fireMessage({ type: "community_reaction", ...payload });
  });
  await flush();
}

test("reaction WS events patch the cached list in place; uncached message falls back to invalidate", async () => {
  const h = await mountChat();
  const { queryClient, socket } = h;
  try {
    assert.ok(messagesFetchCount >= 1, "initial messages fetch happened");
    const fetchesAfterMount = messagesFetchCount;

    // 1. Add a brand-new emoji group to msg-a.
    await fireReaction(socket, { messageId: "msg-a", userId: "cust-9", emoji: "👍", added: true });
    assert.deepEqual(reactionsOf(queryClient, "msg-a"), [{ emoji: "👍", userIds: ["cust-9"] }],
      "new emoji group created with the reactor");

    // 2. Add a second reactor to the now-existing group.
    await fireReaction(socket, { messageId: "msg-a", userId: "cust-10", emoji: "👍", added: true });
    assert.deepEqual(reactionsOf(queryClient, "msg-a"), [{ emoji: "👍", userIds: ["cust-9", "cust-10"] }],
      "reactor appended to the existing group");

    // 3. Duplicate add event (reconnect replay) is a no-op — no double count.
    await fireReaction(socket, { messageId: "msg-a", userId: "cust-10", emoji: "👍", added: true });
    assert.deepEqual(reactionsOf(queryClient, "msg-a"), [{ emoji: "👍", userIds: ["cust-9", "cust-10"] }],
      "duplicate add did not double-count the reactor");

    // 4. Remove one reactor — group survives with the other reactor.
    await fireReaction(socket, { messageId: "msg-a", userId: "cust-9", emoji: "👍", added: false });
    assert.deepEqual(reactionsOf(queryClient, "msg-a"), [{ emoji: "👍", userIds: ["cust-10"] }],
      "removed reactor dropped from the group");

    // 5. Remove the last reactor — the whole emoji group is cleaned up.
    await fireReaction(socket, { messageId: "msg-a", userId: "cust-10", emoji: "👍", added: false });
    assert.deepEqual(reactionsOf(queryClient, "msg-a"), [],
      "empty emoji group removed entirely");

    // 6. Remove event for a reactor that isn't in the group is a no-op.
    await fireReaction(socket, { messageId: "msg-b", userId: "cust-99", emoji: "🎉", added: false });
    assert.deepEqual(reactionsOf(queryClient, "msg-b"), [{ emoji: "🎉", userIds: ["cust-1"] }],
      "removing an absent reactor leaves the group untouched");

    // Other messages were never touched by msg-a's patches.
    assert.deepEqual(reactionsOf(queryClient, "msg-b"), [{ emoji: "🎉", userIds: ["cust-1"] }]);

    // All of the above must have been in-place patches — no refetch.
    assert.equal(messagesFetchCount, fetchesAfterMount,
      "no full-list refetch for cached-message reaction events");

    // 7. Fallback: a reaction for a message NOT in the cache invalidates the
    //    list, which refetches (the query has an active observer).
    await fireReaction(socket, { messageId: "msg-not-cached", userId: "cust-9", emoji: "👍", added: true });
    assert.equal(messagesFetchCount, fetchesAfterMount + 1,
      "uncached message falls back to an invalidate/refetch");
  } finally {
    h.cleanup();
  }
});
