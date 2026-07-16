import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

// Zombie-socket resilience for the auto-reconnecting WS hook.
//
// iOS PWAs silently kill sockets while the app is suspended, but on resume
// `readyState` often still reads OPEN — no close event ever fires. The hook
// must treat a socket that survived a "long" hidden period as untrustworthy
// and force-replace it (firing onOpen on the fresh socket so callers re-send
// presence and run their catch-up refetch). Short hides keep the socket and
// use the onVisible path. A socket stuck CONNECTING across a long hide is
// abandoned and re-dialed too.

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
  closeCalls: number;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  send(data: string): void;
  close(): void;
  fireOpen(): void;
  fireClose(): void;
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
  closeCalls = 0;
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
    this.closeCalls += 1;
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
}

g.WebSocket = MockWebSocket as unknown as typeof WebSocket;
w.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// --- fake timers + fake Date.now (hiddenFor is wall-clock based) -----------

interface ScheduledTask { id: number; runAt: number; fn: () => void; }
let now = 0;
let taskSeq = 0;
let scheduled: ScheduledTask[] = [];
let realSetTimeout: typeof setTimeout;
let realClearTimeout: typeof clearTimeout;
let realDateNow: () => number;

function installFakeTimers(): void {
  now = 0; taskSeq = 0; scheduled = [];
  realSetTimeout = globalThis.setTimeout;
  realClearTimeout = globalThis.clearTimeout;
  realDateNow = Date.now;
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
  Date.now = () => now;
}

function restoreTimers(): void {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  (window as unknown as { setTimeout: typeof setTimeout }).setTimeout = realSetTimeout;
  (window as unknown as { clearTimeout: typeof clearTimeout }).clearTimeout = realClearTimeout;
  Date.now = realDateNow;
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

function mountHook(opts: Partial<Parameters<typeof useReconnectingWebSocket>[0]> = {}) {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const Wrapper: React.FC = () => {
    useReconnectingWebSocket({ path: "/ws", ...opts });
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

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  window.document.dispatchEvent(new window.Event("visibilitychange"));
}

// ---------------------------------------------------------------------------

test("long-hidden OPEN socket is force-replaced on resume (zombie kill)", () => {
  const opens: number[] = [];
  let visibleCalls = 0;
  const h = mountHook({
    onOpen: () => { opens.push(socketLog.length); },
    onVisible: () => { visibleCalls += 1; },
  });
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());
    assert.equal(opens.length, 1, "initial open fired");

    // App backgrounded for 30s — iOS may have killed the pipe while
    // readyState still reads OPEN.
    act(() => setVisibility("hidden"));
    act(() => advanceTime(30_000));
    act(() => setVisibility("visible"));

    assert.equal(h.sockets.length, 2, "fresh socket dialed immediately on resume");
    assert.equal(visibleCalls, 0, "onVisible NOT used for the untrusted socket");
    assert.equal(first.closeCalls, 1, "old socket closed");
    assert.equal(first.onclose, null, "old socket discarded silently (no backoff/status flap)");

    const second = h.sockets[1];
    act(() => second.fireOpen());
    assert.equal(opens.length, 2, "onOpen fires on the replacement so callers re-send presence + catch up");
  } finally {
    h.unmount();
  }
});

test("short-hidden OPEN socket is kept and onVisible fires", () => {
  let visibleCalls = 0;
  const h = mountHook({ onVisible: () => { visibleCalls += 1; } });
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    act(() => setVisibility("hidden"));
    act(() => advanceTime(1_000)); // below the 5s default threshold
    act(() => setVisibility("visible"));

    assert.equal(h.sockets.length, 1, "socket kept across a quick hide");
    assert.equal(visibleCalls, 1, "onVisible fired on the healthy socket");
  } finally {
    h.unmount();
  }
});

test("socket stuck CONNECTING across a long hide is abandoned and re-dialed", () => {
  const h = mountHook();
  try {
    const first = h.sockets[0];
    assert.equal(first.readyState, MockWebSocket.CONNECTING);

    act(() => setVisibility("hidden"));
    act(() => advanceTime(30_000));
    act(() => setVisibility("visible"));

    assert.equal(h.sockets.length, 2, "stalled connect abandoned, fresh dial started");
    assert.equal(first.closeCalls, 1, "stalled socket closed");
  } finally {
    h.unmount();
  }
});

test("CLOSED socket on resume still reconnects immediately (existing contract)", () => {
  const h = mountHook();
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());
    act(() => first.fireClose()); // schedules the 2s backoff

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));

    assert.equal(h.sockets.length, 2, "reconnected without waiting for the backoff");
  } finally {
    h.unmount();
  }
});

test("custom staleAfterHiddenMs threshold is honoured", () => {
  let visibleCalls = 0;
  const h = mountHook({ staleAfterHiddenMs: 60_000, onVisible: () => { visibleCalls += 1; } });
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    act(() => setVisibility("hidden"));
    act(() => advanceTime(30_000)); // long, but below the custom threshold
    act(() => setVisibility("visible"));

    assert.equal(h.sockets.length, 1, "socket kept below the custom threshold");
    assert.equal(visibleCalls, 1);
  } finally {
    h.unmount();
  }
});

// ---------------------------------------------------------------------------
// Source-text guards: the chat pages must wire the catch-up refetch into the
// hook, or a missed-broadcast gap silently returns.
// ---------------------------------------------------------------------------

const COMMUNITY_CHAT = readFileSync(
  join(process.cwd(), "client/src/pages/community-chat-page.tsx"), "utf8",
);
const TICKET_DETAIL = readFileSync(
  join(process.cwd(), "client/src/pages/ticket-detail.tsx"), "utf8",
);

test("community-chat source: onOpen + onVisible run the catch-up invalidation", () => {
  assert.match(COMMUNITY_CHAT, /catchUpOnMissedMessages/, "catch-up helper exists");
  assert.match(
    COMMUNITY_CHAT,
    /invalidateQueries\(\{\s*queryKey:\s*\["\/api\/community-chat\/messages"\]\s*\}\)/,
    "catch-up invalidates the messages query",
  );
  assert.match(COMMUNITY_CHAT, /onOpen:\s*\(\)\s*=>/, "onOpen wired");
  assert.match(COMMUNITY_CHAT, /onVisible:\s*\(\)\s*=>/, "onVisible wired");
  assert.match(COMMUNITY_CHAT, /hasOpenedOnceRef/, "first-open invalidation skipped");
});

test("ticket-detail source: onOpen reconnect + onVisible refetch ticket messages", () => {
  assert.match(TICKET_DETAIL, /hasOpenedOnceRef/, "first-open invalidation skipped");
  assert.match(
    TICKET_DETAIL,
    /onOpen:[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*\["\/api\/tickets",\s*params\.id,\s*"messages"\]\s*\}\)/,
    "onOpen catch-up invalidates the ticket messages query",
  );
  assert.match(
    TICKET_DETAIL,
    /onVisible:[\s\S]*?invalidateQueries\(\{\s*queryKey:\s*\["\/api\/tickets",\s*params\.id,\s*"messages"\]\s*\}\)/,
    "onVisible re-sync invalidates the ticket messages query",
  );
});
