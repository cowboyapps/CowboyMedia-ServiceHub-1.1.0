import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

// Per-page chat reconnect contract tests. The auto-reconnecting WS hook
// itself is covered by test/ticket-presence-socket.test.ts; this file
// pins the callbacks each migrated chat page wires into it.
//
// Two-pronged coverage:
//   1. Runtime: re-wire the hook with payloads identical to what each
//      page sends, drive the mock socket through reconnect/unmount, and
//      assert the right frames go out (or the right query is invalidated).
//   2. Source-text: assert the actual page files still wire the matching
//      payload strings, so the runtime test can't go stale silently when
//      a page is refactored.

// --- jsdom + mock WebSocket (mirrors ticket-presence-socket.test.ts) -------

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
  "HTMLElement", "Element", "Node", "Document", "Event", "CustomEvent",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) g[key] = w[key];
}
g.IS_REACT_ACT_ENVIRONMENT = true;

interface MockSocket {
  url: string;
  readyState: number;
  sent: string[];
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(): void;
  fireOpen(): void;
  fireClose(): void;
  fireMessage(data: unknown): void;
}

let socketLog: MockSocket[] = [];

class MockWebSocket implements MockSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    socketLog.push(this);
  }
  send(data: string): void { this.sent.push(data); }
  close(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new window.Event("close"));
  }
  fireOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new window.Event("open"));
  }
  fireClose(): void {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new window.Event("close"));
  }
  fireMessage(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.({ data: payload } as MessageEvent);
  }
}

g.WebSocket = MockWebSocket as unknown as typeof WebSocket;
w.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// --- fake timers (only setTimeout/clearTimeout used by the hook) -----------

interface ScheduledTask { id: number; runAt: number; fn: () => void; }
let now = 0;
let taskSeq = 0;
let scheduled: ScheduledTask[] = [];
let realSetTimeout: typeof setTimeout;
let realClearTimeout: typeof clearTimeout;

function installFakeTimers(): void {
  now = 0; taskSeq = 0; scheduled = [];
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  const fakeSet = ((fn: () => void, ms?: number): number => {
    const id = ++taskSeq;
    scheduled.push({ id, runAt: now + (ms ?? 0), fn });
    return id as unknown as number;
  }) as unknown as typeof setTimeout;
  const fakeClear = ((id: number): void => {
    scheduled = scheduled.filter((t) => t.id !== id);
  }) as unknown as typeof clearTimeout;
  globalThis.setTimeout = fakeSet;
  globalThis.clearTimeout = fakeClear;
  (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = fakeSet;
  (window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = fakeClear;
}

function restoreTimers(): void {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
  (window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = realClearTimeout;
}

function advanceTime(ms: number): void {
  const target = now + ms;
  while (true) {
    scheduled.sort((a, b) => a.runAt - b.runAt);
    const next = scheduled.find((t) => t.runAt <= target);
    if (!next) break;
    scheduled = scheduled.filter((t) => t.id !== next.id);
    now = next.runAt;
    next.fn();
  }
  now = target;
}

// --- React + hook ----------------------------------------------------------

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { useReconnectingWebSocket } = await import(
  "../client/src/hooks/use-reconnecting-websocket"
);

after(() => {
  try { window.close(); } catch {}
});

beforeEach(() => {
  socketLog = [];
  installFakeTimers();
});

afterEach(() => {
  restoreTimers();
});

interface Harness {
  unmount: () => void;
  sockets: MockSocket[];
}

function mountWithOptions(makeOpts: () => Parameters<typeof useReconnectingWebSocket>[0]): Harness {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () => {
    useReconnectingWebSocket(makeOpts());
    return null;
  };

  const root: Root = createRoot(container);
  act(() => { root.render(React.createElement(Wrapper)); });

  return {
    sockets: socketLog,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fireVisible(): void {
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
}

// ---------------------------------------------------------------------------
// 1. Customer messages page — viewing_thread on visibility reconnect,
//    left_thread on unmount.
// ---------------------------------------------------------------------------

test("messages-page wiring: re-sends viewing_thread on visibility-driven reconnect", () => {
  const threadId = "thread-1";
  const userId = "user-42";
  const expectedViewing = JSON.stringify({ type: "viewing_thread", threadId, userId });

  const h = mountWithOptions(() => ({
    path: "/ws",
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onVisible: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onBeforeUnmount: (ws) => {
      ws.send(JSON.stringify({ type: "left_thread", threadId, userId }));
    },
  }));

  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());
    assert.deepEqual(first.sent, [expectedViewing], "viewing_thread sent on initial open");

    // Network drops the socket; the hook should reconnect after 2s.
    act(() => first.fireClose());
    act(() => advanceTime(2000));
    assert.equal(h.sockets.length, 2, "reconnected after 2s backoff");
    const second = h.sockets[1];
    act(() => second.fireOpen());
    assert.deepEqual(
      second.sent, [expectedViewing],
      "viewing_thread re-sent on the reconnected socket via onOpen",
    );

    // Tab regains focus while the socket is OPEN: onVisible must re-send.
    act(() => fireVisible());
    assert.deepEqual(
      second.sent, [expectedViewing, expectedViewing],
      "viewing_thread re-sent on visibilitychange while OPEN",
    );
  } finally {
    h.unmount();
  }
});

test("messages-page wiring: sends left_thread on unmount when socket is OPEN", () => {
  const threadId = "thread-1";
  const userId = "user-42";
  const expectedLeft = JSON.stringify({ type: "left_thread", threadId, userId });

  const h = mountWithOptions(() => ({
    path: "/ws",
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onBeforeUnmount: (ws) => {
      ws.send(JSON.stringify({ type: "left_thread", threadId, userId }));
    },
  }));

  const first = h.sockets[0];
  act(() => first.fireOpen());
  const beforeUnmountSentCount = first.sent.length;

  h.unmount();

  assert.equal(first.sent.length, beforeUnmountSentCount + 1, "one extra send on unmount");
  assert.equal(
    first.sent[first.sent.length - 1], expectedLeft,
    "left_thread sent right before the socket is closed",
  );
});

// ---------------------------------------------------------------------------
// 2. Admins on the shared /messages screen — since Task #297 unified admin +
//    customer Messages, admins drive the same messages-page wiring as
//    customers (there's no separate admin thread tab anymore). These pin that
//    an admin user gets the same viewing_thread/left_thread contract.
// ---------------------------------------------------------------------------

test("messages-page wiring (admin user): re-sends viewing_thread on visibility-driven reconnect", () => {
  const threadId = "thread-9";
  const userId = "admin-1";
  const expectedViewing = JSON.stringify({ type: "viewing_thread", threadId, userId });

  const h = mountWithOptions(() => ({
    path: "/ws",
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onVisible: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onBeforeUnmount: (ws) => {
      ws.send(JSON.stringify({ type: "left_thread", threadId, userId }));
    },
  }));

  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    act(() => first.fireClose());
    act(() => advanceTime(2000));
    const second = h.sockets[1];
    act(() => second.fireOpen());
    assert.deepEqual(
      second.sent, [expectedViewing],
      "viewing_thread re-sent on the reconnected socket",
    );

    act(() => fireVisible());
    assert.deepEqual(
      second.sent, [expectedViewing, expectedViewing],
      "viewing_thread re-sent on visibilitychange while OPEN",
    );
  } finally {
    h.unmount();
  }
});

test("messages-page wiring (admin user): sends left_thread on unmount when socket is OPEN", () => {
  const threadId = "thread-9";
  const userId = "admin-1";
  const expectedLeft = JSON.stringify({ type: "left_thread", threadId, userId });

  const h = mountWithOptions(() => ({
    path: "/ws",
    onOpen: (ws) => {
      ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId }));
    },
    onBeforeUnmount: (ws) => {
      ws.send(JSON.stringify({ type: "left_thread", threadId, userId }));
    },
  }));

  const first = h.sockets[0];
  act(() => first.fireOpen());
  const before = first.sent.length;
  h.unmount();
  assert.equal(first.sent[first.sent.length - 1], expectedLeft);
  assert.equal(first.sent.length, before + 1);
});

// ---------------------------------------------------------------------------
// 3. Community chat — invalidates the messages query on community_message.
// ---------------------------------------------------------------------------

test("community-chat wiring: invalidates /api/community-chat/messages on community_message frames", () => {
  const invalidatedKeys: unknown[][] = [];
  const fakeQueryClient = {
    invalidateQueries: ({ queryKey }: { queryKey: unknown[] }) => {
      invalidatedKeys.push(queryKey);
    },
  };

  const h = mountWithOptions(() => ({
    path: "/ws",
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "community_message") {
          fakeQueryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
        }
      } catch {}
    },
  }));

  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    // Unrelated frame should NOT invalidate.
    act(() => first.fireMessage({ type: "something_else" }));
    assert.equal(invalidatedKeys.length, 0, "unrelated frame ignored");

    // community_message arrives — single invalidation.
    act(() => first.fireMessage({ type: "community_message", id: "m1" }));
    assert.equal(invalidatedKeys.length, 1, "one invalidation after community_message");
    assert.deepEqual(invalidatedKeys[0], ["/api/community-chat/messages"]);

    // After a reconnect the new socket's onmessage must still be wired.
    act(() => first.fireClose());
    act(() => advanceTime(2000));
    const second = h.sockets[1];
    act(() => second.fireOpen());
    act(() => second.fireMessage({ type: "community_message", id: "m2" }));
    assert.equal(invalidatedKeys.length, 2, "invalidation still wired on reconnected socket");
    assert.deepEqual(invalidatedKeys[1], ["/api/community-chat/messages"]);
  } finally {
    h.unmount();
  }
});

// ---------------------------------------------------------------------------
// 4. Source-text guards. These keep the runtime tests above honest: if a
//    page is refactored and its wiring drifts (e.g. drops left_thread on
//    unmount, switches the query key, stops handling community_message),
//    these assertions fail and force the runtime test to be updated too.
// ---------------------------------------------------------------------------

// The admin and the customer share the same thread chat component
// (`ThreadChatView` in messages-page.tsx); the admin reaches it via the
// "Messages" deep-link to /messages. There is no separate admin-portal
// thread chat anymore, so the admin-side contract is guarded against
// messages-page.tsx too.
const MESSAGES_PAGE = readFileSync(
  join(process.cwd(), "client/src/pages/messages-page.tsx"), "utf8",
);
const COMMUNITY_CHAT = readFileSync(
  join(process.cwd(), "client/src/pages/community-chat-page.tsx"), "utf8",
);

// ---------------------------------------------------------------------------
// 5. thread_typing — both pages mirror the same contract: show the typing
//    name when someone else types, clear after 3s, ignore self-typing.
// ---------------------------------------------------------------------------

function mountTypingHarness(threadId: string, currentUserId: string) {
  let typingUser: string | null = null;
  let typingTimeoutId: number | null = null;

  const h = mountWithOptions(() => ({
    path: "/ws",
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "thread_typing" &&
          data.threadId === threadId &&
          data.userId !== currentUserId
        ) {
          typingUser = data.userName;
          if (typingTimeoutId !== null) clearTimeout(typingTimeoutId);
          typingTimeoutId = setTimeout(() => { typingUser = null; }, 3000) as unknown as number;
        }
      } catch {}
    },
  }));

  return {
    sockets: h.sockets,
    unmount: h.unmount,
    getTypingUser: () => typingUser,
  };
}

test("messages-page wiring: thread_typing updates indicator, clears after 3s, ignores self", () => {
  const threadId = "thread-1";
  const userId = "user-42";
  const h = mountTypingHarness(threadId, userId);

  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    // Frame from someone else for this thread → indicator shows their name.
    act(() => first.fireMessage({
      type: "thread_typing", threadId, userId: "other-1", userName: "Alice",
    }));
    assert.equal(h.getTypingUser(), "Alice", "shows other user's name");

    // Frame from the current user must be ignored.
    act(() => first.fireMessage({
      type: "thread_typing", threadId, userId, userName: "Me",
    }));
    assert.equal(h.getTypingUser(), "Alice", "self-typing frame ignored");

    // Frame for a different thread must be ignored.
    act(() => first.fireMessage({
      type: "thread_typing", threadId: "other-thread", userId: "other-1", userName: "Bob",
    }));
    assert.equal(h.getTypingUser(), "Alice", "frame for other thread ignored");

    // After 3s with no fresh frame, the indicator clears.
    act(() => advanceTime(3000));
    assert.equal(h.getTypingUser(), null, "indicator clears after 3s");

    // After a reconnect the new socket's onmessage must still wire typing.
    act(() => first.fireClose());
    act(() => advanceTime(2000));
    const second = h.sockets[1];
    act(() => second.fireOpen());
    act(() => second.fireMessage({
      type: "thread_typing", threadId, userId: "other-1", userName: "Carol",
    }));
    assert.equal(h.getTypingUser(), "Carol", "typing still wired after reconnect");
  } finally {
    h.unmount();
  }
});

// Admins no longer get a dedicated thread tab inside the Admin Portal: since
// Task #297 unified admin + customer Messages into the shared /messages screen,
// admins drive the exact same messages-page wiring. This pins that an admin
// user on /messages still sees typing indicators (and that self-typing frames
// are ignored), mirroring the customer case above.
test("messages-page wiring (admin user): thread_typing updates indicator, clears after 3s, ignores self", () => {
  const threadId = "thread-9";
  const userId = "admin-1";
  const h = mountTypingHarness(threadId, userId);

  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    act(() => first.fireMessage({
      type: "thread_typing", threadId, userId: "customer-7", userName: "Dana",
    }));
    assert.equal(h.getTypingUser(), "Dana");

    act(() => first.fireMessage({
      type: "thread_typing", threadId, userId, userName: "Admin Self",
    }));
    assert.equal(h.getTypingUser(), "Dana", "self-typing ignored on admin side");

    act(() => advanceTime(3000));
    assert.equal(h.getTypingUser(), null, "admin indicator clears after 3s");
  } finally {
    h.unmount();
  }
});

test("messages-page source: still wires onVisible→viewing_thread and onBeforeUnmount→left_thread", () => {
  assert.match(MESSAGES_PAGE, /useReconnectingWebSocket\(\{/, "uses the shared hook");
  assert.match(MESSAGES_PAGE, /onVisible:\s*\(ws\)\s*=>/, "onVisible wired");
  assert.match(MESSAGES_PAGE, /onBeforeUnmount:\s*\(ws\)\s*=>/, "onBeforeUnmount wired");
  // Payload strings the runtime test mirrors.
  assert.match(MESSAGES_PAGE, /type:\s*"viewing_thread"/);
  assert.match(MESSAGES_PAGE, /type:\s*"left_thread"/);
});

test("admin/customer thread source: wires onOpen/onVisible/onBeforeUnmount + thread_message live-invalidate", () => {
  // Same shared component the admin uses for customer threads.
  assert.match(MESSAGES_PAGE, /useReconnectingWebSocket\(\{/, "uses the shared hook");
  assert.match(MESSAGES_PAGE, /onOpen:\s*\(ws\)\s*=>/, "onOpen wired");
  assert.match(MESSAGES_PAGE, /onVisible:\s*\(ws\)\s*=>/, "onVisible wired");
  assert.match(MESSAGES_PAGE, /onBeforeUnmount:\s*\(ws\)\s*=>/, "onBeforeUnmount wired");
  assert.match(MESSAGES_PAGE, /type:\s*"viewing_thread"/);
  assert.match(MESSAGES_PAGE, /type:\s*"left_thread"/);
  assert.match(
    MESSAGES_PAGE,
    /data\.type\s*===\s*"thread_message"[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*\["\/api\/message-threads",\s*threadId,\s*"messages"\]\s*\}\)/,
    "thread_message frame invalidates the thread messages query",
  );
});

test("messages-page source: still wires thread_typing handler (other-user check + 3s clear)", () => {
  assert.match(
    MESSAGES_PAGE,
    /data\.type\s*===\s*"thread_typing"[\s\S]*?data\.userId\s*!==\s*user\?\.id/,
    "thread_typing branch checks data.userId !== current user",
  );
  assert.match(
    MESSAGES_PAGE,
    /setTypingUser\(null\)[\s\S]{0,20}3000/,
    "typing indicator clears via a 3000ms setTimeout",
  );
});

test("admin/customer thread source: wires thread_typing + thread_messages_read with other-user checks", () => {
  assert.match(
    MESSAGES_PAGE,
    /data\.type\s*===\s*"thread_typing"[\s\S]*?data\.userId\s*!==\s*user\?\.id/,
    "thread_typing branch checks data.userId !== current user",
  );
  assert.match(
    MESSAGES_PAGE,
    /data\.type\s*===\s*"thread_messages_read"[\s\S]*?data\.readBy\s*!==\s*user\?\.id/,
    "thread_messages_read branch checks data.readBy !== current user",
  );
  assert.match(
    MESSAGES_PAGE,
    /data\.type\s*===\s*"thread_messages_read"[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*\["\/api\/message-threads",\s*threadId,\s*"messages"\]\s*\}\)/,
    "thread_messages_read invalidates the thread messages query",
  );
});

test("community-chat source: still invalidates /api/community-chat/messages on community_message", () => {
  assert.match(COMMUNITY_CHAT, /useReconnectingWebSocket\(\{/);
  assert.match(COMMUNITY_CHAT, /data\.type\s*===\s*"community_message"/);
  assert.match(
    COMMUNITY_CHAT,
    /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/community-chat\/messages"\]\s*\}\)/,
  );
});
