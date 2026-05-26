import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals (mirrors test/chat-composer.test.ts) ---------------------
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

// --- WebSocket mock ---------------------------------------------------------
// A controllable WebSocket double. The hook constructs it with `new`, so we
// install it as the global constructor. Each instance records what it was
// called with, lets the test drive lifecycle callbacks (open/close/message),
// and captures every `send()` payload.

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
  // test helpers
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
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    socketLog.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
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
}

g.WebSocket = MockWebSocket as unknown as typeof WebSocket;
w.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// --- Fake timer harness -----------------------------------------------------
// Node's built-in test runner doesn't ship vitest-style fake timers, so we
// monkey-patch setTimeout/clearTimeout for the duration of each test. The
// hook only uses setTimeout for the reconnect backoff, so this is enough.

interface ScheduledTask {
  id: number;
  runAt: number;
  fn: () => void;
}

let now = 0;
let taskSeq = 0;
let scheduled: ScheduledTask[] = [];
let realSetTimeout: typeof setTimeout;
let realClearTimeout: typeof clearTimeout;

function installFakeTimers(): void {
  now = 0;
  taskSeq = 0;
  scheduled = [];
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
  // Drain tasks in scheduled order, accounting for tasks that schedule more
  // tasks at or before `target`.
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

// --- React + hook import (after jsdom + WS mock are installed) -------------
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { useReconnectingWebSocket } = await import(
  "../client/src/hooks/use-reconnecting-websocket"
);

after(() => {
  try {
    window.close();
  } catch {}
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

function mountHook(opts: {
  onOpen?: (ws: MockSocket) => void;
  onVisible?: (ws: MockSocket) => void;
  onBeforeUnmount?: (ws: MockSocket) => void;
}): Harness {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () => {
    useReconnectingWebSocket({
      path: "/ws",
      reconnectDelayMs: 2000,
      onOpen: (ws) => opts.onOpen?.(ws as unknown as MockSocket),
      onVisible: (ws) => opts.onVisible?.(ws as unknown as MockSocket),
      onBeforeUnmount: (ws) =>
        opts.onBeforeUnmount?.(ws as unknown as MockSocket),
    });
    return null;
  };

  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(Wrapper));
  });

  return {
    sockets: socketLog,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Regressions covered:
//
// If the WS effect ever stops re-subscribing after the network blips (e.g. a
// future refactor drops the `onclose → setTimeout(connect, 2000)` line, or
// the visibilitychange listener forgets to reconnect when the socket is
// CLOSED), customers would be left looking at stale presence/typing/message
// data with no visible error. These two tests pin the recovery contract
// described in task #247.

test("WS reconnects after 2s when onclose fires, and re-sends viewing_ticket on the new socket", () => {
  const viewingFrame = JSON.stringify({ type: "viewing_ticket", ticketId: "t1" });
  const h = mountHook({
    onOpen: (ws) => ws.send(viewingFrame),
  });

  try {
    // Initial connect → open → first viewing_ticket frame.
    assert.equal(h.sockets.length, 1, "one socket opened on mount");
    const first = h.sockets[0];
    act(() => first.fireOpen());
    assert.deepEqual(first.sent, [viewingFrame], "viewing_ticket sent on initial open");

    // Network blip: server drops us.
    act(() => first.fireClose());
    assert.equal(h.sockets.length, 1, "no immediate reconnect — backoff in flight");

    // Just before the 2s window — still no new socket.
    act(() => advanceTime(1999));
    assert.equal(h.sockets.length, 1, "no reconnect before the 2s backoff elapses");

    // Cross the 2s threshold — fresh socket constructed.
    act(() => advanceTime(1));
    assert.equal(h.sockets.length, 2, "second socket opened after 2s backoff");

    // The new socket opens → viewing_ticket re-sent so the server resubscribes us.
    const second = h.sockets[1];
    act(() => second.fireOpen());
    assert.deepEqual(
      second.sent,
      [viewingFrame],
      "viewing_ticket re-sent on the reconnected socket",
    );
  } finally {
    h.unmount();
  }
});

test("visibilitychange to 'visible' while socket is CLOSED reconnects immediately (no 2s wait)", () => {
  const viewingFrame = JSON.stringify({ type: "viewing_ticket", ticketId: "t1" });
  const h = mountHook({
    onOpen: (ws) => ws.send(viewingFrame),
  });

  try {
    assert.equal(h.sockets.length, 1);
    const first = h.sockets[0];
    act(() => first.fireOpen());
    assert.deepEqual(first.sent, [viewingFrame]);

    // Tab loses connection — close the socket.
    act(() => first.fireClose());
    assert.equal(h.sockets.length, 1, "still just the first socket");

    // User flips back to the tab WAY before the 2s backoff would have fired.
    Object.defineProperty(window.document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    act(() => {
      window.document.dispatchEvent(new window.Event("visibilitychange"));
    });

    // Immediate reconnect — no need to wait for the backoff.
    assert.equal(
      h.sockets.length,
      2,
      "visibilitychange while CLOSED forces an immediate reconnect",
    );
    const second = h.sockets[1];
    act(() => second.fireOpen());
    assert.deepEqual(
      second.sent,
      [viewingFrame],
      "viewing_ticket re-sent on the reconnected socket",
    );

    // The pending 2s reconnect timer must be cancelled — otherwise it would
    // fire later and open a THIRD socket the customer never asked for.
    act(() => advanceTime(5000));
    assert.equal(
      h.sockets.length,
      2,
      "queued backoff reconnect cancelled — no duplicate socket spawned",
    );
  } finally {
    h.unmount();
  }
});
