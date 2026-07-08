import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/community-chat-reaction-patch.test.ts)
// This is a real render test: it mounts the Community Chat page, drives
// `community_message` and `community_message_edited` WebSocket events through
// the page's live socket handler and asserts the cached message list is
// patched IN PLACE (no full refetch):
//   - a new message is appended once (oldest-first list)
//   - a duplicate `community_message` event (reconnect replay / sender's own
//     invalidate race) is deduped by id — no double append
//   - an edit patches content/editedAt in place on the cached row
//   - a malformed new-message payload (no message.id) falls back to invalidate
//   - an edit for a message NOT in the cache falls back to invalidate
// A regression here would silently bring back full-list refetches on every
// chat message, or duplicate/lose messages on reconnect replays.
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
  reactions: [] as { emoji: string; userIds: string[] }[],
  isAdmin: false,
};

const NEW_MSG = {
  id: "msg-new",
  userId: "cust-4",
  chatUsername: "FourthCustomer",
  content: "Just arrived",
  imageUrl: null,
  pollId: null,
  kbArticle: null,
  createdAt: "2026-01-01T00:05:00.000Z",
  reactions: [] as { emoji: string; userIds: string[] }[],
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
// The test must therefore mount with that same singleton.
const { queryClient: appQueryClient, getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const CommunityChatPage = (await import("../client/src/pages/community-chat-page")).default;

type QC = QueryClientType;

interface CachedMessage {
  id: string;
  content?: string;
  editedAt?: string | null;
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

async function fireEvent(socket: MockWebSocket, payload: Record<string, unknown>): Promise<void> {
  await act(async () => {
    socket.fireMessage(payload);
  });
  await flush();
}

test("new-message and edit WS events patch the cached list in place; malformed/uncached fall back to invalidate", async () => {
  const h = await mountChat();
  const { queryClient, socket } = h;
  try {
    assert.ok(messagesFetchCount >= 1, "initial messages fetch happened");
    const fetchesAfterMount = messagesFetchCount;

    // 1. New message is appended to the end of the cached (oldest-first) list.
    await fireEvent(socket, { type: "community_message", message: NEW_MSG });
    assert.deepEqual(
      getCachedMessages(queryClient).map((m) => m.id),
      ["msg-a", "msg-b", "msg-new"],
      "new message appended at the end",
    );

    // 2. Duplicate event (reconnect replay) is deduped by id — no double append.
    await fireEvent(socket, { type: "community_message", message: NEW_MSG });
    assert.deepEqual(
      getCachedMessages(queryClient).map((m) => m.id),
      ["msg-a", "msg-b", "msg-new"],
      "duplicate community_message event did not duplicate the row",
    );

    // 3. Edit patches content + editedAt in place on the cached row.
    const EDIT_ISO = "2026-01-01T00:10:00.000Z";
    await fireEvent(socket, {
      type: "community_message_edited",
      messageId: "msg-a",
      content: "Hello everyone (edited)",
      editedAt: EDIT_ISO,
    });
    const edited = getCachedMessages(queryClient).find((m) => m.id === "msg-a");
    assert.ok(edited, "edited message still in cache");
    assert.equal(edited.content, "Hello everyone (edited)", "content patched in place");
    assert.equal(edited.editedAt, EDIT_ISO, "editedAt patched in place");

    // Other rows untouched.
    const other = getCachedMessages(queryClient).find((m) => m.id === "msg-b");
    assert.equal(other?.content, "Second message", "other messages untouched by the edit");

    // All of the above must have been in-place patches — no refetch.
    assert.equal(messagesFetchCount, fetchesAfterMount,
      "no full-list refetch for cached new-message/edit events");

    // 4. Malformed new-message payload (no message.id) falls back to invalidate.
    await fireEvent(socket, { type: "community_message", message: { content: "no id" } });
    assert.equal(messagesFetchCount, fetchesAfterMount + 1,
      "malformed community_message payload falls back to an invalidate/refetch");

    // 5. Edit for a message NOT in the cache falls back to invalidate.
    await fireEvent(socket, {
      type: "community_message_edited",
      messageId: "msg-not-cached",
      content: "ghost edit",
      editedAt: EDIT_ISO,
    });
    assert.equal(messagesFetchCount, fetchesAfterMount + 2,
      "uncached edit falls back to an invalidate/refetch");

    // The refetches restored the server list — the appended message is gone
    // (fetch stub returns only MSG_A/MSG_B), confirming these were real refetches.
    assert.deepEqual(
      getCachedMessages(queryClient).map((m) => m.id),
      ["msg-a", "msg-b"],
      "fallback refetch replaced the cache with the server list",
    );

    // 6. Delete removes the cached row in place — no refetch.
    const fetchesBeforeDelete = messagesFetchCount;
    await fireEvent(socket, { type: "community_message_deleted", messageId: "msg-a" });
    assert.deepEqual(
      getCachedMessages(queryClient).map((m) => m.id),
      ["msg-b"],
      "deleted message removed from the cached list in place",
    );
    assert.equal(messagesFetchCount, fetchesBeforeDelete,
      "no full-list refetch for a cached delete event");

    // 7. Delete for a message NOT in the cache falls back to invalidate.
    await fireEvent(socket, { type: "community_message_deleted", messageId: "msg-not-cached" });
    assert.equal(messagesFetchCount, fetchesBeforeDelete + 1,
      "uncached delete falls back to an invalidate/refetch");
    assert.deepEqual(
      getCachedMessages(queryClient).map((m) => m.id),
      ["msg-a", "msg-b"],
      "delete fallback refetch replaced the cache with the server list",
    );

    // 8. Malformed delete payload (no messageId) also falls back to invalidate.
    await fireEvent(socket, { type: "community_message_deleted" });
    assert.equal(messagesFetchCount, fetchesBeforeDelete + 2,
      "malformed delete payload falls back to an invalidate/refetch");
  } finally {
    h.cleanup();
  }
});
