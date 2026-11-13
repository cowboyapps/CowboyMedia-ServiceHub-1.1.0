import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/alerts/alert-1",
  pretendToBeVisual: true,
});
const { window } = dom;
const g = globalThis as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "location", "history", "HTMLElement", "Element", "Node", "Event", "MouseEvent"]) {
  g[key] = key === "window" ? window : (window as unknown as Record<string, unknown>)[key];
}
g.IS_REACT_ACT_ENVIRONMENT = true;
g.addEventListener = window.addEventListener.bind(window);
g.removeEventListener = window.removeEventListener.bind(window);
g.dispatchEvent = window.dispatchEvent.bind(window);
g.requestAnimationFrame = window.requestAnimationFrame.bind(window);
g.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
let reducedMotion = false;
window.matchMedia = ((query: string) => ({
  matches: reducedMotion && query === "(prefers-reduced-motion: reduce)",
})) as typeof window.matchMedia;
Object.defineProperty(window, "innerWidth", { value: 390 });
const scrolls: { target: HTMLElement; options: ScrollIntoViewOptions }[] = [];
window.HTMLElement.prototype.scrollIntoView = function (options) {
  scrolls.push({ target: this, options: options as ScrollIntoViewOptions });
};

const React = await import("react");
g.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const AlertDetail = (await import("../client/src/pages/alert-detail")).default;
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: Infinity } },
});
setupComponentTestTeardown({ queryClient, window });

const updatesKey = ["/api/alerts", undefined, "updates"];
function update(id: string, createdAt: string) {
  return { id, alertId: "alert-1", createdAt, status: "monitoring", message: `<p>Update ${id}</p>`, imageUrl: null };
}
const older = update("older", "2026-11-10T10:00:00Z");
const newest = update("newest", "2026-11-11T12:00:00Z");
const middle = update("middle", "2026-11-11T09:00:00Z");

async function flush() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

async function mount(updates?: ReturnType<typeof update>[], options: { latest?: boolean; reduced?: boolean } = {}) {
  window.history.replaceState(null, "", `/alerts/alert-1${options.latest ? "?latest=1" : ""}`);
  reducedMotion = options.reduced ?? false;
  scrolls.length = 0;
  queryClient.setQueryData(["/api/alerts", undefined], {
    id: "alert-1", title: "Service interruption",
    description: `<p>${"Long original alert. ".repeat(150)}</p>`,
    status: "investigating", severity: "warning", serviceIds: [],
    createdAt: "2026-11-10T09:00:00Z", resolvedAt: null, imageUrl: null,
  });
  queryClient.setQueryData(["/api/services"], []);
  if (updates) queryClient.setQueryData(updatesKey, updates);
  // Keep the initial update request pending until the test supplies its data.
  queryClient.setQueryDefaults(updatesKey, { queryFn: () => new Promise(() => {}) });
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(AlertDetail)));
  });
  await flush();
  return {
    container,
    button: () => container.querySelector<HTMLButtonElement>('[data-testid="button-view-latest-update"]'),
    row: (id: string) => container.querySelector<HTMLElement>(`[data-testid="alert-update-${id}"]`),
    order: () => Array.from(container.querySelectorAll("li")).map((li) => li.dataset.testid),
    cleanup: () => { act(() => root.unmount()); container.remove(); queryClient.clear(); },
  };
}

test("phone jump focuses the timestamp-latest update without changing timeline order", async () => {
  const c = await mount([older, newest, middle]);
  try {
    const originalOrder = ["alert-update-older", "alert-update-newest", "alert-update-middle"];
    assert.deepEqual(c.order(), originalOrder);
    assert.ok(c.row("newest")!.querySelector('[data-testid="badge-alert-latest"]'));
    const button = c.button()!;
    assert.equal(button.textContent?.trim(), "View latest update");
    assert.ok(button.closest("section")!.querySelector('[data-testid="text-alert-title"]'));
    assert.ok(button.classList.contains("min-h-11"), "44px phone touch target");
    act(() => button.click());
    assert.equal(window.document.activeElement, c.row("newest"));
    assert.equal(scrolls[0].target, c.row("newest"));
    assert.deepEqual(scrolls[0].options, { behavior: "smooth", block: "start", inline: "nearest" });
    assert.equal(c.row("newest")!.tabIndex, -1, "focusable without adding timeline rows to tab order");
    assert.equal(c.row("newest")!.style.scrollMarginTop, "1rem");
    assert.match(c.row("newest")!.style.scrollMarginBottom, /--sab/);
    assert.deepEqual(c.order(), originalOrder);
  } finally { c.cleanup(); }
});

test("reduced motion jumps instantly even if the site uses smooth scrolling", async () => {
  const c = await mount([newest]);
  try {
    reducedMotion = true;
    act(() => c.button()!.click());
    assert.equal(scrolls[0].options.behavior, "instant");
    assert.equal(window.document.activeElement, c.row("newest"));
  } finally { c.cleanup(); }
});

test("no jump action appears until updates provide a target", async () => {
  const c = await mount();
  try {
    assert.equal(c.button(), null);
    await act(async () => { queryClient.setQueryData(updatesKey, []); });
    await flush();
    assert.equal(c.button(), null);
    assert.ok(c.container.querySelector('[data-testid="badge-alert-latest"]'), "original alert remains latest");
    await act(async () => { queryClient.setQueryData(updatesKey, [newest]); });
    await flush();
    assert.ok(c.button());
    act(() => c.button()!.click());
    assert.equal(scrolls[0].target, c.row("newest"));
  } finally { c.cleanup(); }
});

test("refreshes and deletions retarget the action without using detached updates", async () => {
  const c = await mount([older, newest, middle]);
  try {
    const deletedTarget = c.row("newest");
    await act(async () => { queryClient.setQueryData(updatesKey, [older, middle]); });
    await flush();
    assert.equal(deletedTarget!.isConnected, false);
    act(() => c.button()!.click());
    assert.equal(scrolls.at(-1)!.target, c.row("middle"));
    const refreshed = update("refreshed", "2026-11-11T14:00:00Z");
    await act(async () => { queryClient.setQueryData(updatesKey, [older, refreshed, middle]); });
    await flush();
    assert.ok(c.row("refreshed")!.querySelector('[data-testid="badge-alert-latest"]'));
    act(() => c.button()!.click());
    assert.equal(scrolls.at(-1)!.target, c.row("refreshed"));
    assert.deepEqual(c.order(), ["alert-update-older", "alert-update-refreshed", "alert-update-middle"]);
    await act(async () => { queryClient.setQueryData(updatesKey, []); });
    await flush();
    assert.equal(c.button(), null);
    assert.equal(c.order().length, 0);
  } finally { c.cleanup(); }
});

test("timestamp ties keep the existing latest marker and jump target consistent", async () => {
  const tied = update("tied", newest.createdAt);
  const c = await mount([older, tied, newest]);
  try {
    act(() => c.button()!.click());
    assert.equal(scrolls[0].target, c.row("tied"));
    assert.ok(c.row("tied")!.querySelector('[data-testid="badge-alert-latest"]'));
    assert.deepEqual(c.order(), ["alert-update-older", "alert-update-tied", "alert-update-newest"]);
  } finally { c.cleanup(); }
});

async function settleJump() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 80)); });
}

test("dashboard deep link waits for updates, focuses newest once, and preserves history order", async () => {
  const c = await mount(undefined, { latest: true });
  try {
    await settleJump();
    assert.equal(scrolls.length, 0, "no unavailable target is announced or scrolled");
    await act(async () => { queryClient.setQueryData(updatesKey, [older, newest, middle]); });
    await flush();
    await settleJump();
    assert.equal(scrolls.length, 1);
    assert.equal(scrolls[0].target, c.row("newest"));
    assert.equal(window.document.activeElement, c.row("newest"));
    assert.deepEqual(c.order(), ["alert-update-older", "alert-update-newest", "alert-update-middle"]);
    await act(async () => {
      queryClient.setQueryData(updatesKey, [older, newest, middle, update("later", "2026-11-12T12:00:00Z")]);
    });
    await flush();
    await settleJump();
    assert.equal(scrolls.length, 1, "background refresh does not steal focus or scroll again");
  } finally { c.cleanup(); }
});

test("dashboard deep link respects reduced motion and ordinary alert visits never auto-scroll", async () => {
  const c = await mount([newest], { latest: true, reduced: true });
  try {
    await settleJump();
    assert.equal(scrolls[0]?.options.behavior, "instant");
  } finally { c.cleanup(); }
  const ordinary = await mount([newest]);
  try {
    await settleJump();
    assert.equal(scrolls.length, 0);
  } finally { ordinary.cleanup(); }
});

test("deep link with no updates stays on the original report without fabricating a target", async () => {
  const c = await mount([], { latest: true });
  try {
    await settleJump();
    assert.equal(scrolls.length, 0);
    assert.equal(c.button(), null);
    assert.ok(c.container.querySelector('[data-testid="badge-alert-latest"]'));
  } finally { c.cleanup(); }
});

test("failed update reads show retry instead of claiming there were no updates", async () => {
  const c = await mount(undefined, { latest: true });
  try {
    await act(async () => {
      queryClient.getQueryCache().find({ queryKey: updatesKey, exact: true })!.setState({
        status: "error", fetchStatus: "idle", error: new Error("503: Updates unavailable"),
      });
    });
    await flush();
    await settleJump();
    assert.ok(c.container.querySelector('[data-testid="error-alert-updates"]'));
    assert.ok(c.container.querySelector('[data-testid="error-alert-updates-retry"]'));
    assert.doesNotMatch(c.container.textContent ?? "", /No updates posted yet/);
    assert.equal(c.button(), null);
    assert.equal(scrolls.length, 0);
  } finally { c.cleanup(); }
});
