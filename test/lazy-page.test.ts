import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><body></body>", { url: "https://example.com", pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window, document: dom.window.document, navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement, Node: dom.window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const React = await import("react");
Object.assign(globalThis, { React });
const { createRoot } = await import("react-dom/client");
const { QueryClient } = await import("@tanstack/react-query");
const { Router, Route, useParams, useLocation } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { lazyPage } = await import("../client/src/components/lazy-page");
setupComponentTestTeardown({ queryClient: new QueryClient(), window: dom.window });

async function settle() {
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

test("secondary page is deferred, shows accessible loading, and keeps direct-link params and local state", async () => {
  let loads = 0, mounts = 0;
  let finish!: (value: { default: React.ComponentType }) => void;
  const Page = lazyPage(() => { loads++; return new Promise(resolve => { finish = resolve; }); });
  const location = memoryLocation({ path: "/items/example" });
  function Content() {
    const { id } = useParams();
    const [, navigate] = useLocation();
    const [count, setCount] = React.useState(0);
    React.useEffect(() => { mounts++; }, []);
    return React.createElement("button", { onClick: () => { setCount(n => n + 1); navigate("/items/next"); } }, `${id}:${count}`);
  }
  assert.equal(loads, 0, "defining routes does not download their code");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await React.act(async () => {
      root.render(React.createElement(Router, {
        hook: location.hook,
        children: React.createElement(Route, { path: "/items/:id", component: Page }),
      }));
    });
    assert.equal(loads, 1);
    assert.ok(container.querySelector('[role="status"][aria-label="Loading page"]'));
    await React.act(async () => { finish({ default: Content }); });
    assert.equal(container.textContent, "example:0");
    await React.act(async () => { container.querySelector("button")!.click(); });
    await settle();
    assert.equal(container.textContent, "next:1");
    assert.equal(mounts, 1, "a lazy route never mounts a duplicate outgoing tree");
  } finally { await React.act(async () => root.unmount()); }
});

test("a failed page download can be retried without reloading the app", async () => {
  let loads = 0;
  const Page = lazyPage(async () => {
    if (++loads === 1) throw new Error("Example unavailable chunk");
    return { default: () => React.createElement("p", null, "Page recovered") };
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const error = console.error;
  console.error = () => {}; // React reports the deliberately rejected fixture.
  try {
    await React.act(async () => { root.render(React.createElement(Page)); });
    await settle();
    assert.ok(container.querySelector('[role="alert"]'));
    await React.act(async () => { container.querySelector("button")!.click(); });
    await settle();
    assert.match(container.textContent!, /Page recovered/);
    assert.equal(loads, 2);
  } finally { console.error = error; await React.act(async () => root.unmount()); }
});

test("a rendering bug is not treated as an obsolete bundle and offers explicit recovery", async () => {
  sessionStorageClear();
  const Page = lazyPage(async () => ({
    default: () => { throw new Error("Example render bug"); },
  }));
  const container = document.createElement("div");
  const root = createRoot(container);
  const error = console.error;
  console.error = () => {};
  try {
    await React.act(async () => { root.render(React.createElement(Page)); });
    await settle();
    assert.ok(container.querySelector('[data-testid="page-load-error"]'));
    assert.deepEqual(Array.from(container.querySelectorAll("button")).map(button => button.textContent), ["Try again", "Reload app"]);
    assert.equal(dom.window.sessionStorage.length, 0, "runtime errors never claim the import-reload guard");
  } finally { console.error = error; await React.act(async () => root.unmount()); }
});

function sessionStorageClear() {
  dom.window.sessionStorage.clear();
}
