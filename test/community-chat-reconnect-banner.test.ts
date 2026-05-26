import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

// --- jsdom globals (mirrors test/ticket-presence-socket.test.ts) ------------
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
const { act, useEffect, useState } = React;
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

// ---------------------------------------------------------------------------
// The component below mirrors the reconnect-banner state machine that lives
// inline in `client/src/pages/community-chat-page.tsx` (see the
// `connectionBanner` useState + two effects around the `wsStatus` branch).
// Keeping it as a faithful copy here means a future refactor that changes
// the contract — losing the 3s debounce, dropping the 2s "recovered" flash,
// or renaming the `banner-connection-{reconnecting,recovered}` test IDs —
// will trip these assertions instead of silently regressing the cue.

const ChatBannerHarness: React.FC = () => {
  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    reconnectDelayMs: 2000,
  });

  const [connectionBanner, setConnectionBanner] = useState<
    "reconnecting" | "recovered" | null
  >(null);

  useEffect(() => {
    if (wsStatus === "closed") {
      const t = setTimeout(() => setConnectionBanner("reconnecting"), 3000);
      return () => clearTimeout(t);
    }
    if (wsStatus === "open") {
      setConnectionBanner((prev) => (prev === "reconnecting" ? "recovered" : prev));
    }
  }, [wsStatus]);

  useEffect(() => {
    if (connectionBanner !== "recovered") return;
    const t = setTimeout(() => setConnectionBanner(null), 2000);
    return () => clearTimeout(t);
  }, [connectionBanner]);

  if (!connectionBanner) return null;
  return React.createElement(
    "div",
    {
      "data-testid":
        connectionBanner === "reconnecting"
          ? "banner-connection-reconnecting"
          : "banner-connection-recovered",
    },
    connectionBanner === "reconnecting" ? "Reconnecting…" : "Live again",
  );
};

interface Harness {
  unmount: () => void;
  container: HTMLDivElement;
  sockets: MockSocket[];
}

function mountHarness(): Harness {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  act(() => {
    root.render(React.createElement(ChatBannerHarness));
  });
  return {
    container,
    sockets: socketLog,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function findBanner(container: HTMLElement, kind: "reconnecting" | "recovered"): Element | null {
  return container.querySelector(`[data-testid="banner-connection-${kind}"]`);
}

// ---------------------------------------------------------------------------
// Regression: task #253 added the reconnect cue to community chat using the
// shared hook. The 3s debounce keeps the banner off during normal browser
// blips (a sub-second close + immediate reopen shouldn't flash anything),
// and the 2s "Live again" recovery flash gives customers a positive
// confirmation that their feed is live again.

test("community chat: banner stays hidden during a sub-3s blip", () => {
  const h = mountHarness();
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());
    assert.equal(findBanner(h.container, "reconnecting"), null, "no banner while open");

    // Brief blip: socket closes, hook's 2s backoff spawns a new socket,
    // and we let it reopen well before the banner's 3s debounce expires.
    act(() => first.fireClose());
    act(() => advanceTime(2500));
    assert.equal(
      findBanner(h.container, "reconnecting"),
      null,
      "reconnecting banner is debounced for the first 3s",
    );

    // Second socket was constructed by the hook's backoff at t=2000.
    assert.equal(h.sockets.length, 2, "hook spawned a fresh socket via backoff");
    const second = h.sockets[1];
    act(() => second.fireOpen());
    act(() => advanceTime(5000));
    assert.equal(
      findBanner(h.container, "reconnecting"),
      null,
      "sub-3s blip never surfaces the reconnect banner",
    );
    assert.equal(
      findBanner(h.container, "recovered"),
      null,
      "and no 'Live again' flash either — nothing was ever shown to recover from",
    );
  } finally {
    h.unmount();
  }
});

test("community chat: 'Reconnecting…' appears after >3s offline, then flashes 'Live again' for 2s on recovery", () => {
  const h = mountHarness();
  try {
    const first = h.sockets[0];
    act(() => first.fireOpen());

    // Network drops. The hook schedules a 2s reconnect; the banner effect
    // schedules its own 3s debounce.
    act(() => first.fireClose());

    // Just before the 3s threshold — banner must still be hidden.
    act(() => advanceTime(2999));
    assert.equal(
      findBanner(h.container, "reconnecting"),
      null,
      "banner stays hidden right up to the 3s mark",
    );

    // Cross the threshold — banner appears.
    act(() => advanceTime(1));
    const reconnecting = findBanner(h.container, "reconnecting");
    assert.ok(reconnecting, "reconnecting banner appears after 3s offline");
    assert.match(reconnecting!.textContent ?? "", /Reconnecting/);

    // The hook will have spawned a fresh socket via its 2s backoff (which
    // fired during the advance above). Fire its open event → banner flips
    // to the 'recovered' flash.
    const latest = h.sockets[h.sockets.length - 1];
    assert.notEqual(latest, first, "hook reconnected with a fresh socket");
    act(() => latest.fireOpen());

    assert.equal(
      findBanner(h.container, "reconnecting"),
      null,
      "reconnecting banner is gone once the socket reopens",
    );
    const recovered = findBanner(h.container, "recovered");
    assert.ok(recovered, "recovered banner flashes on recovery");
    assert.match(recovered!.textContent ?? "", /Live again/);

    // Just before the 2s flash window expires — still visible.
    act(() => advanceTime(1999));
    assert.ok(
      findBanner(h.container, "recovered"),
      "recovered banner stays visible for the full 2s flash",
    );

    // Cross the threshold — banner disappears.
    act(() => advanceTime(1));
    assert.equal(
      findBanner(h.container, "recovered"),
      null,
      "recovered banner clears itself after 2s",
    );
  } finally {
    h.unmount();
  }
});

// ---------------------------------------------------------------------------
// Source-text guards. The runtime tests above mount a local harness that
// mirrors the banner state machine inlined in community-chat-page.tsx —
// fast, but it only protects against contract drift if the page actually
// keeps the same wiring. These string assertions (same pattern as
// test/chat-reconnect-wiring.test.ts) pin the real page's banner code so
// a refactor that drops the 3s debounce, the 2s flash, the test IDs, or
// the hook call itself will fail this file instead of silently regressing
// the cue customers see.

const COMMUNITY_CHAT = readFileSync(
  join(process.cwd(), "client/src/pages/community-chat-page.tsx"),
  "utf8",
);

test("community-chat source: still uses the shared reconnecting WS hook", () => {
  assert.match(
    COMMUNITY_CHAT,
    /useReconnectingWebSocket\(\{/,
    "page must drive wsStatus through the shared hook",
  );
});

test("community-chat source: still renders both banner test IDs", () => {
  assert.match(
    COMMUNITY_CHAT,
    /"banner-connection-reconnecting"/,
    "reconnecting banner test ID is still rendered",
  );
  assert.match(
    COMMUNITY_CHAT,
    /"banner-connection-recovered"/,
    "recovered banner test ID is still rendered",
  );
});

test("community-chat source: still pins the 3s debounce and 2s flash timings", () => {
  // 3s debounce before showing "Reconnecting…" when wsStatus flips to closed.
  assert.match(
    COMMUNITY_CHAT,
    /setTimeout\(\(\)\s*=>\s*setConnectionBanner\("reconnecting"\),\s*3000\)/,
    "3s debounce before showing the reconnecting banner",
  );
  // 2s flash of "Live again" before the banner clears itself.
  assert.match(
    COMMUNITY_CHAT,
    /setTimeout\(\(\)\s*=>\s*setConnectionBanner\(null\),\s*2000\)/,
    "2s flash before clearing the recovered banner",
  );
  // The closed→open transition flips reconnecting → recovered (not straight
  // to null), so the customer actually sees the recovery flash.
  assert.match(
    COMMUNITY_CHAT,
    /prev\s*===\s*"reconnecting"\s*\?\s*"recovered"\s*:\s*prev/,
    "open transition flips reconnecting → recovered, not straight to null",
  );
});

test("community-chat source: still shows the customer-facing banner copy", () => {
  assert.match(COMMUNITY_CHAT, /Reconnecting/);
  assert.match(COMMUNITY_CHAT, /Live again/);
});
