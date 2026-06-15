import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the My Services page's empty-state contract
// (client/src/pages/my-services-page.tsx). The page stacks three sections that
// must be mutually exclusive about who "owns" a blank page:
//   - MyActiveServices       (reads /api/my/services)
//   - MyMonitoredServices    (reads /api/my/whmcs-services)
//   - NoServicesNotice       (reads BOTH; renders ONLY when neither other section
//                             would render anything)
// This locks in that the notice never double-renders alongside a populated
// monitored-services list, and still appears (with the "link your account" CTA)
// when nothing else can render.

// --- jsdom globals + polyfills (mirrors test/billing-confirmation-banner.test.ts)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/my-services",
});
const { window } = dom;

type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
// wouter's useBrowserLocation reads the bare global `location`/`history` and
// subscribes via the bare global add/removeEventListener.
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

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

// Any background refetch a primed query kicks off resolves to an empty body; the
// tests assert against setQueryData-primed caches, not the network.
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
g.fetch = (async () => jsonResponse({})) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
// my-services-page.tsx uses the classic JSX transform; the free `React`
// identifier must resolve to a global.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const MyServicesPage = (await import("../client/src/pages/my-services-page")).default;

after(() => {
  try {
    queryClient.clear();
    window.close();
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

interface ActivePayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: unknown[];
}
interface MonitoredPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: unknown[];
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountPage(active: ActivePayload, monitored: MonitoredPayload): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/my/services"], active);
  queryClient.setQueryData(["/api/my/whmcs-services"], monitored);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MyServicesPage),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

const NOT_WIRED: ActivePayload = { configured: false, enabled: false, linked: false, unreachable: false, services: [] };
const NOT_WIRED_MON: MonitoredPayload = { configured: false, enabled: false, linked: false, unreachable: false, services: [] };

function monitoredService(id: number) {
  return { id, name: `Service ${id}`, description: "", status: "operational" };
}

test("no-services notice renders when neither section has anything to show", async () => {
  const c = await mountPage(NOT_WIRED, NOT_WIRED_MON);
  try {
    assert.ok(findByTestId(c.container, "card-no-services"), "empty-state notice is shown");
    assert.equal(findByTestId(c.container, "my-active-services"), null, "no active-services section");
    assert.equal(findByTestId(c.container, "my-monitored-services"), null, "no monitored-services section");
  } finally {
    c.cleanup();
  }
});

test("unlinked account shows the link-your-account CTA in the notice", async () => {
  const c = await mountPage(
    { configured: true, enabled: true, linked: false, unreachable: false, services: [] },
    { configured: true, enabled: true, linked: false, unreachable: false, services: [] },
  );
  try {
    assert.ok(findByTestId(c.container, "card-no-services"), "notice shown for an unlinked account");
    const cta = findByTestId(c.container, "button-link-account");
    assert.ok(cta, "link-your-account CTA present when configured+enabled but unlinked");
  } finally {
    c.cleanup();
  }
});

test("notice is suppressed when monitored services render, even if active services is unwired", async () => {
  const c = await mountPage(NOT_WIRED, {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    services: [monitoredService(1), monitoredService(2)],
  });
  try {
    assert.ok(findByTestId(c.container, "my-monitored-services"), "monitored section renders");
    assert.equal(
      findByTestId(c.container, "card-no-services"),
      null,
      "notice does NOT double-render alongside a populated monitored list",
    );
  } finally {
    c.cleanup();
  }
});

test("notice is suppressed when active services owns the page (linked + live)", async () => {
  const c = await mountPage(
    { configured: true, enabled: true, linked: true, unreachable: false, services: [] },
    NOT_WIRED_MON,
  );
  try {
    assert.ok(findByTestId(c.container, "my-active-services"), "active-services section renders");
    assert.equal(
      findByTestId(c.container, "card-no-services"),
      null,
      "notice does NOT render when active services owns the empty/list state",
    );
  } finally {
    c.cleanup();
  }
});
