import { test, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals (mirrors test/community-chat-reconnect-banner.test.ts) ---
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

// --- React + component import (after jsdom is installed) -------------------
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { LiveConnectionBanner } = await import(
  "../client/src/components/live-connection-banner"
);
type Status = "connecting" | "open" | "closed";

after(() => {
  try {
    window.close();
  } catch {}
});

beforeEach(() => {
  installFakeTimers();
});

afterEach(() => {
  restoreTimers();
});

interface Harness {
  unmount: () => void;
  container: HTMLDivElement;
  setStatus: (s: Status) => void;
}

function mountHarness(initial: Status): Harness {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  let setStatus!: (s: Status) => void;

  const Wrapper: React.FC<{ initial: Status }> = ({ initial }) => {
    const [status, setS] = React.useState<Status>(initial);
    setStatus = (s: Status) => {
      act(() => setS(s));
    };
    return React.createElement(LiveConnectionBanner, { status });
  };

  act(() => {
    root.render(React.createElement(Wrapper, { initial }));
  });

  return {
    container,
    setStatus,
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
// LiveConnectionBanner is the shared cue used by ticket-detail, community
// chat, messages, admin portal, admin dashboard, and news detail. It hides
// blip-length disconnects (the hook backs off and reopens within a second
// or two) and shows a brief "Live again" flash on recovery. These tests
// pin the 3s debounce and 2s flash timings so the contract every consumer
// depends on can't be tweaked away without a test failure.

test("LiveConnectionBanner: status=open renders nothing", () => {
  const h = mountHarness("open");
  try {
    assert.equal(h.container.children.length, 0, "no banner while open");
    assert.equal(findBanner(h.container, "reconnecting"), null);
    assert.equal(findBanner(h.container, "recovered"), null);
  } finally {
    h.unmount();
  }
});

test("LiveConnectionBanner: closed for >3s shows 'Reconnecting…'", () => {
  const h = mountHarness("open");
  try {
    h.setStatus("closed");

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
  } finally {
    h.unmount();
  }
});

test("LiveConnectionBanner: reopening after >3s flashes 'Live again' for 2s", () => {
  const h = mountHarness("open");
  try {
    h.setStatus("closed");
    act(() => advanceTime(3000));
    assert.ok(
      findBanner(h.container, "reconnecting"),
      "reconnecting banner is visible after 3s",
    );

    h.setStatus("open");
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

test("LiveConnectionBanner: sub-3s blip never shows the banner", () => {
  const h = mountHarness("open");
  try {
    // Brief blip: closed for less than 3s, then reopens.
    h.setStatus("closed");
    act(() => advanceTime(2500));
    assert.equal(
      findBanner(h.container, "reconnecting"),
      null,
      "reconnecting banner is debounced for the first 3s",
    );

    h.setStatus("open");
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
