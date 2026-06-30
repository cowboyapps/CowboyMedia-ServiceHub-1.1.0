import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the shared QueryErrorState
// (client/src/components/query-error-state.tsx) that every data-driven page now
// renders on its query `isError` branch. Locks in three contracts:
//   - a TimeoutError reads as a connection/timeout message (not a generic one)
//   - any other error reads as a generic "something went wrong" message
//   - the Retry button invokes the supplied onRetry handler (refetch)

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
g.location = window.location;
g.history = window.history;
g.addEventListener = window.addEventListener.bind(window);
g.removeEventListener = window.removeEventListener.bind(window);
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
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

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryErrorState } = await import("../client/src/components/query-error-state");
const { TimeoutError } = await import("../client/src/lib/queryClient");

after(() => {
  try {
    window.close();
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mount(props: Parameters<typeof QueryErrorState>[0]): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(QueryErrorState, props));
  });
  await flushFrames();
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

test("TimeoutError reads as a connection/timeout message", async () => {
  const c = await mount({
    error: new TimeoutError(),
    onRetry: () => {},
    resourceName: "news",
    "data-testid": "error-news",
  });
  try {
    const msg = findByTestId(c.container, "error-news-message");
    assert.ok(msg, "error message element is present");
    assert.match(msg!.textContent ?? "", /timed out/i, "timeout copy mentions timing out");
    assert.match(msg!.textContent ?? "", /connection/i, "timeout copy mentions connection");
  } finally {
    c.cleanup();
  }
});

test("a non-timeout error reads as a generic failure message", async () => {
  const c = await mount({
    error: new Error("500: Internal Server Error"),
    onRetry: () => {},
    resourceName: "news",
    "data-testid": "error-news",
  });
  try {
    const msg = findByTestId(c.container, "error-news-message");
    assert.ok(msg, "error message element is present");
    assert.match(msg!.textContent ?? "", /something went wrong/i, "generic copy used");
    assert.doesNotMatch(msg!.textContent ?? "", /timed out/i, "no timeout copy for a generic error");
  } finally {
    c.cleanup();
  }
});

test("Retry button invokes the onRetry handler", async () => {
  let retries = 0;
  const c = await mount({
    error: new Error("500: boom"),
    onRetry: () => { retries += 1; },
    resourceName: "news",
    "data-testid": "error-news",
  });
  try {
    const btn = findByTestId(c.container, "error-news-retry") as HTMLButtonElement | null;
    assert.ok(btn, "retry button is present");
    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();
    assert.equal(retries, 1, "clicking Retry calls onRetry exactly once");
  } finally {
    c.cleanup();
  }
});

test("Retry button is disabled while a retry is in flight", async () => {
  const c = await mount({
    error: new Error("500: boom"),
    onRetry: () => {},
    isRetrying: true,
    resourceName: "news",
    "data-testid": "error-news",
  });
  try {
    const btn = findByTestId(c.container, "error-news-retry") as HTMLButtonElement | null;
    assert.ok(btn, "retry button is present");
    assert.equal(btn!.disabled, true, "button disabled while retrying");
    assert.match(btn!.textContent ?? "", /retrying/i, "shows retrying label");
  } finally {
    c.cleanup();
  }
});
