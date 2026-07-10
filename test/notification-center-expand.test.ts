import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// React component coverage for the expand/collapse behaviour of grouped rows in
// client/src/components/notification-center.tsx (NotificationList).
//
// Locks in the "Smarter notification groups" contract:
//   - tapping a multi-item group expands it in place (revealing per-item rows)
//     instead of dismissing the whole group
//   - tapping again collapses it
//   - a single-item group has no chevron and tapping it opens/dismisses directly
//   - opening one sub-item dismisses ONLY that item (PATCH for its id) and
//     navigates to its url; the rest of the group survives
//   - dismissing one sub-item removes ONLY that item; the group-level dismiss
//     still removes every item at once
//   - "Clear all" marks everything read
//
// The list fetches ["/api/notifications"] via the shared queryFn; we seed the
// cache with setQueryData and stub fetch to record PATCH/POST calls.

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
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException", "MutationObserver",
  "SVGElement", "SVGSVGElement",
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

class DOMRectStub implements DOMRect {
  x = 0; y = 0; width = 0; height = 0;
  top = 0; right = 0; bottom = 0; left = 0;
  toJSON(): unknown { return this; }
}
g.DOMRect = DOMRectStub;
w.DOMRect = DOMRectStub;

interface PointerCaptureProto {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
  getBoundingClientRect: () => DOMRect;
}
const HEProto = window.HTMLElement.prototype as unknown as PointerCaptureProto;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};
HEProto.getBoundingClientRect = () => new DOMRectStub();

g.IS_REACT_ACT_ENVIRONMENT = true;

const fetchCalls: { method: string; url: string }[] = [];
let seededNotifications: unknown[] = [];
g.fetch = (async (input: unknown, init?: { method?: string }) => {
  const url = typeof input === "string" ? input : String(input);
  const method = init?.method ?? "GET";
  fetchCalls.push({ method, url });
  // Behave like the real backend so onSettled refetches stay consistent with the
  // optimistic updates: dismiss removes the row, mark-all-read stamps readAt.
  const dismissMatch = /\/api\/notifications\/([^/]+)\/dismiss$/.exec(url);
  if (method === "PATCH" && dismissMatch) {
    const id = dismissMatch[1];
    seededNotifications = (seededNotifications as { id: string }[]).filter((x) => x.id !== id);
  } else if (method === "POST" && url.endsWith("/api/notifications/mark-all-read")) {
    const now = new Date().toISOString();
    seededNotifications = (seededNotifications as { readAt: string | null }[]).map((x) =>
      x.readAt ? x : { ...x, readAt: now },
    );
  }
  // Serve the seeded list back on the list refetch so groupNotifications always
  // receives an array (a bare {} would blow up the render mid-test).
  let bodyObj: unknown = {};
  if (method === "GET" && /\/api\/notifications(\?.*)?$/.test(url)) {
    bodyObj = seededNotifications;
  } else if (method === "GET" && url.includes("/api/notifications/unread-count")) {
    bodyObj = { count: (seededNotifications as { readAt: string | null }[]).filter((x) => !x.readAt).length };
  }
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => bodyObj,
    text: async () => JSON.stringify(bodyObj),
    clone() { return this; },
  };
}) as unknown as typeof fetch;
w.fetch = g.fetch;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { NotificationList } = await import("../client/src/components/notification-center");
type UserNotification = import("../client/src/lib/notification-grouping").UserNotification;

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

function n(partial: Partial<UserNotification> & { id: string; createdAt: string }): UserNotification {
  return {
    userId: "u1",
    type: "ticket_update",
    title: "Notification",
    body: "body",
    referenceType: null,
    referenceId: null,
    url: null,
    readAt: null,
    dismissedAt: null,
    ...partial,
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  navigations: string[];
  cleanup: () => void;
}

async function mountList(notifications: UserNotification[]): Promise<MountResult> {
  fetchCalls.length = 0;
  seededNotifications = notifications;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  queryClient.setQueryData(["/api/notifications"], notifications);
  queryClient.setQueryData(["/api/notifications/unread-count"], {
    count: notifications.filter((x) => !x.readAt).length,
  });
  const navigations: string[] = [];

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(NotificationList, { onNavigate: (u: string) => navigations.push(u) }),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  return {
    container,
    root,
    navigations,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

const GROUP = [
  n({ id: "a", type: "ticket_update", referenceType: "ticket", referenceId: "t1", url: "/tickets/t1#a", title: "First reply", createdAt: "2026-07-05T10:00:00Z" }),
  n({ id: "b", type: "ticket_update", referenceType: "ticket", referenceId: "t1", url: "/tickets/t1#b", title: "Second reply", createdAt: "2026-07-05T11:00:00Z" }),
  n({ id: "c", type: "ticket_update", referenceType: "ticket", referenceId: "t1", url: "/tickets/t1#c", title: "Third reply", createdAt: "2026-07-05T12:00:00Z" }),
];

test("tapping a multi-item group expands it in place instead of dismissing", async () => {
  const c = await mountList(GROUP);
  try {
    // Latest (c) drives the collapsed row; chevron signals expandability.
    const row = findByTestId(c.container, "notification-item-c");
    assert.ok(row, "collapsed group row renders keyed on the latest notification");
    assert.ok(findByTestId(c.container, "chevron-group-ticket-t1"), "multi-item group shows a chevron");
    assert.equal(findByTestId(c.container, "notification-subitem-a"), null, "sub-items hidden before expand");

    await act(async () => { (row as HTMLElement).click(); });
    await flushFrames();

    // No dismiss PATCH fired; all three sub-items are now revealed.
    assert.equal(fetchCalls.filter((f) => f.method === "PATCH").length, 0, "expanding does not dismiss anything");
    for (const id of ["a", "b", "c"]) {
      assert.ok(findByTestId(c.container, `notification-subitem-${id}`), `sub-item ${id} revealed`);
    }
    assert.equal(c.navigations.length, 0, "expanding does not navigate");

    assert.equal(
      findByTestId(c.container, "notification-item-c")?.getAttribute("aria-expanded"),
      "true",
      "row reports expanded state after first tap",
    );

    // Tapping again collapses (assert on aria-expanded — the state flips instantly,
    // whereas AnimatePresence keeps the exiting rows briefly in the DOM).
    await act(async () => { (findByTestId(c.container, "notification-item-c") as HTMLElement).click(); });
    await flushFrames();
    assert.equal(
      findByTestId(c.container, "notification-item-c")?.getAttribute("aria-expanded"),
      "false",
      "second tap collapses the group",
    );
  } finally {
    c.cleanup();
  }
});

test("opening one sub-item dismisses only that item and navigates to its url", async () => {
  const c = await mountList(GROUP);
  try {
    await act(async () => { (findByTestId(c.container, "notification-item-c") as HTMLElement).click(); });
    await flushFrames();

    await act(async () => { (findByTestId(c.container, "notification-subitem-a") as HTMLElement).click(); });
    await flushFrames();

    const patches = fetchCalls.filter((f) => f.method === "PATCH");
    assert.equal(patches.length, 1, "exactly one dismiss fired");
    assert.match(patches[0].url, /\/api\/notifications\/a\/dismiss$/, "dismissed only the opened item");
    assert.deepEqual(c.navigations, ["/tickets/t1#a"], "navigated to the opened item's url");

    // Optimistic cache still holds the other two.
    const remaining = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]) ?? [];
    assert.deepEqual(remaining.map((x) => x.id).sort(), ["b", "c"], "other group members survive");
  } finally {
    c.cleanup();
  }
});

test("dismissing one sub-item removes only that item", async () => {
  const c = await mountList(GROUP);
  try {
    await act(async () => { (findByTestId(c.container, "notification-item-c") as HTMLElement).click(); });
    await flushFrames();

    await act(async () => { (findByTestId(c.container, "button-dismiss-item-b") as HTMLElement).click(); });
    await flushFrames();

    const patches = fetchCalls.filter((f) => f.method === "PATCH");
    assert.equal(patches.length, 1, "one dismiss fired");
    assert.match(patches[0].url, /\/api\/notifications\/b\/dismiss$/, "dismissed only b");
    assert.equal(c.navigations.length, 0, "per-item dismiss never navigates");

    const remaining = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]) ?? [];
    assert.deepEqual(remaining.map((x) => x.id).sort(), ["a", "c"], "only b removed");
  } finally {
    c.cleanup();
  }
});

test("group-level dismiss still removes every item at once", async () => {
  const c = await mountList(GROUP);
  try {
    await act(async () => { (findByTestId(c.container, "button-dismiss-ticket-t1") as HTMLElement).click(); });
    await flushFrames();

    const patches = fetchCalls.filter((f) => f.method === "PATCH").map((f) => f.url);
    assert.equal(patches.length, 3, "all three dismissed");
    for (const id of ["a", "b", "c"]) {
      assert.ok(patches.some((u) => u.endsWith(`/api/notifications/${id}/dismiss`)), `dismissed ${id}`);
    }
    const remaining = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]) ?? [];
    assert.equal(remaining.length, 0, "group cleared");
  } finally {
    c.cleanup();
  }
});

test("single-item group has no chevron and tapping it opens directly", async () => {
  const single = [
    n({ id: "solo", type: "news", url: "/news/1", title: "One-off", createdAt: "2026-07-05T10:00:00Z" }),
  ];
  const c = await mountList(single);
  try {
    assert.equal(findByTestId(c.container, "chevron-group-solo"), null, "no chevron on a single-item group");

    await act(async () => { (findByTestId(c.container, "notification-item-solo") as HTMLElement).click(); });
    await flushFrames();

    const patches = fetchCalls.filter((f) => f.method === "PATCH");
    assert.equal(patches.length, 1, "single tap dismisses");
    assert.match(patches[0].url, /\/api\/notifications\/solo\/dismiss$/);
    assert.deepEqual(c.navigations, ["/news/1"], "single tap navigates");
  } finally {
    c.cleanup();
  }
});

test("Clear all marks everything read", async () => {
  const c = await mountList(GROUP);
  try {
    await act(async () => { (findByTestId(c.container, "button-mark-all-read") as HTMLElement).click(); });
    await flushFrames();

    assert.ok(
      fetchCalls.some((f) => f.method === "POST" && f.url.endsWith("/api/notifications/mark-all-read")),
      "mark-all-read POST fired",
    );
    // The list query is observed by the mounted component (so it survives the
    // teardown helper's gcTime:0); assert every row is now read.
    const list = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]) ?? [];
    assert.equal(list.length, 3, "rows still present, just marked read");
    assert.ok(list.every((x) => !!x.readAt), "every notification marked read");
  } finally {
    c.cleanup();
  }
});
