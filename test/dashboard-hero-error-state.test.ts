import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the cockpit dashboard's health hero: when the
// /api/services read FAILS, the hero must NOT claim "All Systems Go" (a false
// green all-clear on a dead network is a user-facing accuracy bug). It must
// render the neutral "Status Unavailable" state instead, and the strip below
// still swaps to the shared QueryErrorState. Also proves the happy paths in
// both directions so a future edit can't invert the branch:
//   - all services operational  -> green "All Systems Go"
//   - a service in outage       -> red "1 Service Down"

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

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Controllable fetch stub ------------------------------------------------
// servicesMode flips only the /api/services read; everything else the page
// touches (alerts, news, tickets, per-service uptime) returns benign empties.
type ServicesMode = "error" | "operational" | "outage";
let servicesMode: ServicesMode = "error";

const SVC_ID = "svc-hero-test-1";
function servicesPayload() {
  return [
    {
      id: SVC_ID,
      name: "Hero Test Service",
      description: "",
      status: servicesMode === "outage" ? "outage" : "operational",
      category: "hosting",
      sortOrder: 0,
    },
  ];
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
    clone() {
      return this;
    },
  };
}

const fetchStub = (async (url: unknown) => {
  const u = String(url);
  if (/\/api\/services\/[^/]+\/uptime/.test(u)) {
    return jsonResponse({ hasMonitor: false, uptime30d: null, dailyBuckets: [] });
  }
  if (u.includes("/api/services")) {
    if (servicesMode === "error") {
      return jsonResponse("Internal Server Error", 500);
    }
    return jsonResponse(servicesPayload());
  }
  if (u.includes("/api/auth/me")) {
    return jsonResponse({ id: "u1", username: "hero", fullName: "Hero Tester", role: "customer" });
  }
  if (u.includes("/api/alerts")) return jsonResponse([]);
  if (u.includes("/api/news")) return jsonResponse([]);
  if (u.includes("/api/tickets")) return jsonResponse([]);
  return jsonResponse({});
}) as unknown as typeof fetch;
g.fetch = fetchStub;
w.fetch = fetchStub;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const Dashboard = (await import("../client/src/pages/dashboard")).default;

after(() => {
  try {
    window.close();
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(n = 8): Promise<void> {
  for (let i = 0; i < n; i++) {
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
  client: InstanceType<typeof QueryClient>;
  root: Root;
  cleanup: () => void;
}

async function mountDashboard(): Promise<MountResult> {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        retry: false,
        gcTime: 0,
        staleTime: 0,
        refetchOnWindowFocus: false,
        networkMode: "offlineFirst",
      },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["/api/auth/me"], {
    id: "u1",
    username: "hero",
    fullName: "Hero Tester",
    role: "customer",
  });

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(AuthProvider, null, React.createElement(Dashboard)),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  return {
    container,
    client,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      client.clear();
    },
  };
}

test("hero never shows a green all-clear when the services read fails", async () => {
  servicesMode = "error";
  const c = await mountDashboard();
  try {
    const title = findByTestId(c.container, "text-dashboard-title");
    assert.ok(title, "hero title renders");
    assert.doesNotMatch(
      title!.textContent ?? "",
      /all systems go/i,
      "must not claim all-clear on a failed services read",
    );
    assert.match(
      title!.textContent ?? "",
      /status unavailable/i,
      "uses the neutral unavailable copy",
    );
    assert.ok(
      findByTestId(c.container, "error-dashboard-services"),
      "the service strip below still shows the shared error state",
    );
  } finally {
    c.cleanup();
  }
});

test("hero shows the green all-clear when every service is operational", async () => {
  servicesMode = "operational";
  const c = await mountDashboard();
  try {
    const title = findByTestId(c.container, "text-dashboard-title");
    assert.ok(title, "hero title renders");
    assert.match(title!.textContent ?? "", /all systems go/i);
    assert.ok(
      findByTestId(c.container, `card-service-health-${SVC_ID}`),
      "the service card renders in the strip",
    );
  } finally {
    c.cleanup();
  }
});

test("hero reports the outage when a service is down", async () => {
  servicesMode = "outage";
  const c = await mountDashboard();
  try {
    const title = findByTestId(c.container, "text-dashboard-title");
    assert.ok(title, "hero title renders");
    assert.doesNotMatch(title!.textContent ?? "", /all systems go/i);
    assert.match(
      title!.textContent ?? "",
      /1 service down/i,
      "names the outage count",
    );
  } finally {
    c.cleanup();
  }
});
