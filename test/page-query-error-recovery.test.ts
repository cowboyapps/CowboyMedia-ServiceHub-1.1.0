import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Integration coverage proving a *real* list page (AlertsPage) actually swaps
// its content for the shared QueryErrorState when its data query fails, and that
// clicking Retry refetches and brings the list back once the network recovers.
//
// The isolated QueryErrorState unit test (test/query-error-state.test.ts) only
// renders the component in a vacuum; this test wires the page's real
// `useQuery` -> `isError` -> <QueryErrorState> branch through React Query and a
// controllable global fetch, guarding against a page silently forgetting to
// render its error/retry branch in a future edit. Covers both the TimeoutError
// copy (connection/timeout wording) and a generic server-error message, and the
// end-to-end Retry-recovers-the-list flow.

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/alerts",
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

// --- Controllable fetch stub ------------------------------------------------
// Mode flips what the /api/alerts read does: simulate a client-side timeout
// (getQueryFn surfaces a TimeoutError), a server 500 (generic Error), or a
// successful payload. Every other endpoint the page touches (e.g. /api/services,
// the mark-read POST) returns a benign empty body so they never interfere.
type FetchMode = "timeout" | "generic" | "success";
let fetchMode: FetchMode = "timeout";

const ALERT_ID = 987654;
function alertsPayload() {
  return [
    {
      id: ALERT_ID,
      title: "Recovered Alert Title",
      description: "It came back after retry",
      severity: "critical",
      status: "investigating",
      serviceIds: [],
      createdAt: new Date("2026-06-01T10:00:00Z").toISOString(),
      resolvedAt: null,
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
  if (u.includes("/api/alerts")) {
    if (fetchMode === "timeout") {
      // What getQueryFn throws once its abort deadline fires on a dead socket.
      throw new TimeoutError();
    }
    if (fetchMode === "generic") {
      return jsonResponse("Internal Server Error", 500);
    }
    return jsonResponse(alertsPayload());
  }
  // /api/services and the mark-read POST: harmless responses.
  if (u.includes("/api/services")) return jsonResponse([]);
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
const { getQueryFn, TimeoutError } = await import("../client/src/lib/queryClient");
const AlertsPage = (await import("../client/src/pages/alerts-page")).default;

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

async function mountAlertsPage(): Promise<MountResult> {
  // A fresh client per mount: retry disabled so a failed read lands on the
  // isError branch immediately (no 1s+ backoff), gcTime/staleTime 0 so Retry
  // really refetches and teardown doesn't leave the process alive.
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

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(AlertsPage),
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

test("a real list page swaps to the timeout error state when the read times out", async () => {
  fetchMode = "timeout";
  const c = await mountAlertsPage();
  try {
    const errState = findByTestId(c.container, "error-alerts");
    assert.ok(errState, "the page renders the shared error state on a failed read");
    // The list content (tabs) must be gone — the error state owns the page.
    assert.equal(
      findByTestId(c.container, "tab-active-alerts"),
      null,
      "the normal list content is swapped out for the error state",
    );
    const msg = findByTestId(c.container, "error-alerts-message");
    assert.ok(msg, "error message element present");
    assert.match(msg!.textContent ?? "", /timed out/i, "uses timeout copy");
    assert.match(msg!.textContent ?? "", /connection/i, "mentions the connection");
    assert.ok(
      findByTestId(c.container, "error-alerts-retry"),
      "a Retry button is offered",
    );
  } finally {
    c.cleanup();
  }
});

test("a real list page shows the generic error state on a server failure", async () => {
  fetchMode = "generic";
  const c = await mountAlertsPage();
  try {
    assert.ok(findByTestId(c.container, "error-alerts"), "error state rendered");
    const msg = findByTestId(c.container, "error-alerts-message");
    assert.ok(msg, "error message element present");
    assert.match(
      msg!.textContent ?? "",
      /something went wrong/i,
      "uses the generic failure copy for a non-timeout error",
    );
    assert.doesNotMatch(
      msg!.textContent ?? "",
      /timed out/i,
      "no timeout wording for a generic server error",
    );
  } finally {
    c.cleanup();
  }
});

test("clicking Retry refetches and the list reappears once the network recovers", async () => {
  fetchMode = "generic";
  const c = await mountAlertsPage();
  try {
    // Starts on the error state.
    assert.ok(findByTestId(c.container, "error-alerts"), "starts on the error state");
    assert.equal(
      findByTestId(c.container, `card-alert-${ALERT_ID}`),
      null,
      "no alert card while the read is failing",
    );

    // Network recovers, then the user hits Retry.
    fetchMode = "success";
    const retry = findByTestId(c.container, "error-alerts-retry") as
      | HTMLButtonElement
      | null;
    assert.ok(retry, "retry button present");
    await act(async () => {
      retry!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    // The error state is gone and the list content is back.
    assert.equal(
      findByTestId(c.container, "error-alerts"),
      null,
      "error state is dismissed after a successful refetch",
    );
    assert.ok(
      findByTestId(c.container, "tab-active-alerts"),
      "the normal list content (tabs) reappears",
    );
    assert.ok(
      findByTestId(c.container, `card-alert-${ALERT_ID}`),
      "the recovered alert card renders after Retry",
    );
  } finally {
    c.cleanup();
  }
});
