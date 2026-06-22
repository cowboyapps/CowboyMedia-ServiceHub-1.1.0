import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  installLongTimerGuard,
  setupComponentTestTeardown,
} from "./helpers/component-test-teardown";

// Proves the shared teardown helper (test/helpers/component-test-teardown.ts)
// does its job, so future component tests can opt in with one line instead of
// rediscovering the "mutation leaves a 5-minute gc timer that hangs the file"
// trap. Two angles:
//   1. The long-timer GUARD catches a leaked, ref'd long timer (the "fail loudly
//      instead of hang" promise) and ignores short/unref'd/cleared ones.
//   2. A real component that fires a useMutation and unmounts exits CLEANLY under
//      setupComponentTestTeardown — no bespoke per-file timer handling, and the
//      guard reports nothing lingering.

// --- jsdom globals + polyfills (mirrors the other render tests).
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
  "HTMLElement", "HTMLButtonElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException", "MutationObserver",
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

g.IS_REACT_ACT_ENVIRONMENT = true;

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
  };
}

let posts = 0;
g.fetch = (async (_url: unknown, init?: { method?: string }) => {
  if ((init?.method ?? "GET").toUpperCase() !== "GET") posts++;
  return jsonResponse({ ok: true });
}) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider, useMutation } = await import("@tanstack/react-query");

// A throwaway client with the DEFAULT (5-minute) gcTime — exactly the shape that
// would hang the file after a mutation. The helper must collapse it to 0.
const client = new QueryClient();

// One-line opt-in: this is the whole point of the task.
const guard = setupComponentTestTeardown({ queryClient: client, window });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

// A minimal component that fires a POST mutation on mount — the exact pattern
// (useMutation -> unmount) that schedules React Query's lingering gc timer.
const MutatingWidget: React.FC = () => {
  const mutation = useMutation({
    mutationFn: async () => {
      await fetch("/api/noop", { method: "POST" });
      return true;
    },
  });
  const mutateRef = React.useRef(mutation.mutate);
  mutateRef.current = mutation.mutate;
  React.useEffect(() => {
    mutateRef.current();
  }, []);
  return React.createElement("div", { "data-testid": "widget" }, "ok");
};

test("the long-timer guard flags a leaked ref'd long timer and ignores benign ones", () => {
  const localGuard = installLongTimerGuard(30_000);
  try {
    // A long, ref'd timer that is never cleared — the thing that hangs a file.
    const leaked = setTimeout(() => {}, 5 * 60_000);
    // A short timer: well under the threshold, must be ignored.
    const shortId = setTimeout(() => {}, 0);
    // A long timer we explicitly clear: must be ignored.
    const clearedId = setTimeout(() => {}, 5 * 60_000);
    clearTimeout(clearedId);
    // A long but UNREF'd timer (e.g. the toast-removal timer): must be ignored.
    const unreffed = setTimeout(() => {}, 5 * 60_000);
    (unreffed as unknown as { unref?: () => void }).unref?.();

    const offenders = localGuard.check();
    assert.equal(offenders.length, 1, "only the leaked ref'd long timer is flagged");
    assert.match(offenders[0], /pending and ref'd/, "the message points at the lingering timer");

    // Clean up so we don't leak into the rest of the file.
    clearTimeout(leaked);
    clearTimeout(shortId);
    assert.deepEqual(localGuard.check(), [], "clearing the offender makes the guard clean");
  } finally {
    localGuard.uninstall();
  }
});

test("a component that fires a mutation mounts, posts, and unmounts cleanly under the helper", async () => {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(MutatingWidget),
      ),
    );
  });
  await flushFrames();

  assert.ok(
    container.querySelector('[data-testid="widget"]'),
    "the widget mounted",
  );
  assert.equal(posts, 1, "the mutation fired its POST");

  // Unmount — this is where the default-gcTime client would schedule a 5-minute
  // gc timer. Because the helper collapsed gcTime to 0, nothing long-lived is
  // left behind.
  await act(async () => {
    root.unmount();
  });
  container.remove();
  await flushFrames();

  assert.deepEqual(
    guard?.check() ?? [],
    [],
    "no long-lived timer survives the mutation+unmount under the helper",
  );
});
