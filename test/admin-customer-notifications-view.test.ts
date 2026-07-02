import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// React component coverage for the admin customer-notification-history view
// (CustomerNotificationsSection in client/src/pages/admin-portal.tsx). The
// backend handler's contract is unit-tested in
// server/admin-user-notifications-route.test.ts; this locks in the client glue:
//   - rows render in the order the API returns them (server sends newest-first)
//   - the three status badges are chosen by the dismissed → read → unseen
//     precedence (dismissed wins even when a row is also read)
//   - the empty state shows the right copy for "all" vs a specific type filter
//   - changing the type filter refetches with the new `type` query param and
//     swaps the rendered rows
// The section makes its own `fetch` (not the shared queryFn), so a fetch stub
// keyed on the `type` param serves each page and records the requested URLs.

// --- jsdom globals + polyfills (mirrors test/store-catalogue-sort.test.ts) ---
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/admin",
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

// Radix Select touches a few DOM APIs jsdom omits; stub them so opening the
// trigger never throws.
interface HEStub {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
}
const HEProto = window.HTMLElement.prototype as unknown as HEStub;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- fetch stub: serve the notifications endpoint per `type` param ----------
interface AdminUserNotification {
  id: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  url: string | null;
  createdAt: string;
  readAt: string | null;
  dismissedAt: string | null;
}

function makeNotif(over: Partial<AdminUserNotification> = {}): AdminUserNotification {
  return {
    id: over.id ?? "n1",
    type: over.type ?? "news",
    title: over.title ?? "Title",
    body: over.body ?? "Body",
    referenceType: over.referenceType ?? null,
    referenceId: over.referenceId ?? null,
    url: over.url ?? null,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00Z",
    readAt: over.readAt ?? null,
    dismissedAt: over.dismissedAt ?? null,
  };
}

// Keyed by the `type` query param ("all" when absent). Each test sets this
// before mounting; the fetch stub returns the matching single page.
let pagesByType: Record<string, AdminUserNotification[]> = {};
const requestedUrls: string[] = [];

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

g.fetch = (async (url: unknown) => {
  const str = String(url);
  if (str.includes("/notifications")) {
    requestedUrls.push(str);
    const params = new URLSearchParams(str.split("?")[1] ?? "");
    const type = params.get("type") ?? "all";
    const rows = pagesByType[type] ?? [];
    return jsonResponse({ notifications: rows, hasMore: false });
  }
  return jsonResponse({});
}) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates. --
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { CustomerNotificationsSection } = await import("../client/src/pages/admin-portal");

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  },
});

setupComponentTestTeardown({ queryClient, window });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 6; i++) {
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

async function mountSection(userId = "cust-1"): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(CustomerNotificationsSection, { userId }),
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

// The rendered notification rows in DOM order, as their ids.
function rowOrder(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll('[data-testid^="row-customer-notification-"]')).map(
    (el) => el.getAttribute("data-testid")!.replace("row-customer-notification-", ""),
  );
}

// Drive the Radix Select the way a mouse user does: a primary-button mouse
// pointerdown opens the menu (Radix only opens for pointerType "mouse"), then a
// click on the option (found by its visible label) fires onValueChange.
async function selectFilterByLabel(label: string): Promise<void> {
  const trigger = findByTestId(window.document.body, "select-notification-type-filter") as HTMLElement | null;
  assert.ok(trigger, "the type-filter select trigger is present");
  await act(async () => {
    trigger!.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
  await flushFrames();

  const options = Array.from(window.document.body.querySelectorAll('[role="option"]')) as HTMLElement[];
  const item = options.find((el) => el.textContent?.trim() === label);
  assert.ok(item, `the "${label}" option is present once the menu opens`);
  await act(async () => {
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flushFrames();
}

test("renders rows in server order (newest-first) with the three status badges", async () => {
  // Server returns newest-first; the section renders as-is. One row per status
  // so the dismissed → read → unseen badge precedence is all exercised.
  pagesByType = {
    all: [
      makeNotif({ id: "new", type: "news", title: "Newest", createdAt: "2026-03-03T00:00:00Z" }),
      makeNotif({ id: "read", type: "ticket_update", title: "Middle", createdAt: "2026-02-02T00:00:00Z", readAt: "2026-02-02T01:00:00Z" }),
      // dismissed AND read: dismissed must win.
      makeNotif({ id: "dismissed", type: "service_alert", title: "Oldest", createdAt: "2026-01-01T00:00:00Z", readAt: "2026-01-01T01:00:00Z", dismissedAt: "2026-01-01T02:00:00Z" }),
    ],
  };
  const c = await mountSection();
  try {
    const scope = c.container;
    assert.ok(findByTestId(scope, "list-customer-notifications"), "the notification list renders");

    // Order preserved exactly as the server sent it (newest-first).
    assert.deepEqual(rowOrder(scope), ["new", "read", "dismissed"], "rows keep the server's newest-first order");

    // The type label badge maps the raw type to human copy.
    assert.equal(findByTestId(scope, "badge-notification-type-new")?.textContent?.trim(), "News story");

    // The three distinct status badges, chosen by dismissed → read → unseen.
    assert.equal(findByTestId(scope, "badge-notification-status-new")?.textContent?.trim(), "Not yet seen");
    assert.equal(findByTestId(scope, "badge-notification-status-read")?.textContent?.trim(), "Read");
    assert.equal(
      findByTestId(scope, "badge-notification-status-dismissed")?.textContent?.trim(),
      "Dismissed",
      "a dismissed row shows Dismissed even though it is also read",
    );
  } finally {
    c.cleanup();
  }
});

test("shows the empty state with the right copy for 'all' vs a type filter", async () => {
  pagesByType = { all: [], news: [] };
  const c = await mountSection();
  try {
    const empty = findByTestId(c.container, "text-customer-notifications-empty");
    assert.ok(empty, "the empty state renders when there are no notifications");
    assert.match(empty!.textContent ?? "", /hasn't received any notifications yet/);
    assert.equal(findByTestId(c.container, "list-customer-notifications"), null, "no list when empty");

    // Switching to a specific filter (still empty) swaps to the type-specific copy.
    await selectFilterByLabel("News story");
    const emptyFiltered = findByTestId(c.container, "text-customer-notifications-empty");
    assert.ok(emptyFiltered, "the empty state still renders under a type filter");
    assert.match(emptyFiltered!.textContent ?? "", /notifications of this type yet/);
  } finally {
    c.cleanup();
  }
});

test("changing the type filter refetches with the new type and swaps the rows", async () => {
  pagesByType = {
    all: [
      makeNotif({ id: "a-news", type: "news", title: "A news story" }),
      makeNotif({ id: "a-ticket", type: "ticket_update", title: "A ticket update" }),
    ],
    news: [makeNotif({ id: "only-news", type: "news", title: "Just the news" })],
  };
  requestedUrls.length = 0;
  const c = await mountSection();
  try {
    // First load: the unfiltered ("all") request carries no `type` param.
    assert.deepEqual(rowOrder(c.container), ["a-news", "a-ticket"], "all rows render initially");
    assert.ok(
      requestedUrls.some((u) => !new URLSearchParams(u.split("?")[1] ?? "").has("type")),
      "the initial 'all' request omits the type param",
    );

    const before = requestedUrls.length;
    await selectFilterByLabel("News story");

    // A new request went out for the news filter...
    const newRequests = requestedUrls.slice(before);
    assert.ok(newRequests.length > 0, "changing the filter fires a new request");
    assert.ok(
      newRequests.some((u) => new URLSearchParams(u.split("?")[1] ?? "").get("type") === "news"),
      "the refetch carries type=news",
    );

    // ...and the rendered rows swap to the news-only page.
    assert.deepEqual(rowOrder(c.container), ["only-news"], "rows swap to the filtered page");
  } finally {
    c.cleanup();
  }
});
