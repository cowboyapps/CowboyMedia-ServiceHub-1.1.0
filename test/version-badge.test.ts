import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// The header "v9.0" version badge — the quiet replacement for the retired
// "Welcome to version X" popup. Covers:
//   1. Badge always renders the APP_VERSION and links to /whats-new.
//   2. "New" dot shows when the latest PUBLISHED changelog version hasn't
//      been seen on this device.
//   3. Dot hidden once localStorage says the latest version was seen.
//   4. Visiting /whats-new marks the latest published version as seen.
//   5. No published entries → no dot (nothing to announce).
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
g.localStorage = window.localStorage;
g.history = window.history;
g.location = window.location;

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment",
  "Event", "CustomEvent", "MouseEvent", "PopStateEvent",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) g[key] = w[key];
}

g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
g.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { VersionBadge } = await import("../client/src/components/version-badge");
const { AuthProvider } = await import("../client/src/lib/auth");
const { APP_VERSION } = await import("../shared/version");

// Per-user key (mirrors seenKey() in the component) — the mounted test user is u1.
const SEEN_KEY = "whats-new-last-seen-version:u1";

after(() => {
  try { window.close(); } catch {}
});

beforeEach(() => {
  window.localStorage.clear();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

interface Mounted {
  container: HTMLElement;
  cleanup: () => void;
}

async function mount(opts: {
  publishedVersions: string[];
  path?: string;
  loggedIn?: boolean;
}): Promise<Mounted> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  qc.setQueryData(
    ["/api/auth/me"],
    opts.loggedIn === false ? null : { id: "u1", username: "amy", role: "customer" },
  );
  qc.setQueryData(["/api/admin/my-permissions"], []);
  qc.setQueryData(
    ["/api/changelog"],
    opts.publishedVersions.map((v) => ({ version: v, title: `Version ${v}`, bodyHtml: "" })),
  );

  const { hook } = memoryLocation({ path: opts.path ?? "/", static: true });
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(
          AuthProvider,
          null,
          React.createElement(Router, { hook, children: React.createElement(VersionBadge) }),
        ),
      ),
    );
  });
  await flush();
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      qc.clear();
    },
  };
}

const badge = (c: ParentNode) => c.querySelector('[data-testid="badge-app-version"]');
const dot = (c: ParentNode) => c.querySelector('[data-testid="dot-version-new"]');

test("renders vAPP_VERSION linking to /whats-new", async () => {
  const m = await mount({ publishedVersions: [] });
  try {
    const el = badge(m.container);
    assert.ok(el, "badge renders");
    assert.match(el!.textContent ?? "", new RegExp(`v${APP_VERSION.replace(".", "\\.")}`));
    assert.match(el!.getAttribute("href") ?? "", /^\/whats-new#/);
  } finally {
    m.cleanup();
  }
});

test("shows the new-dot when the latest published version is unseen", async () => {
  const m = await mount({ publishedVersions: ["9.0", "8.0"] });
  try {
    assert.ok(dot(m.container), "dot shows for an unseen published version");
  } finally {
    m.cleanup();
  }
});

test("hides the dot once the latest published version was seen on this device", async () => {
  window.localStorage.setItem(SEEN_KEY, "9.0");
  const m = await mount({ publishedVersions: ["9.0", "8.0"] });
  try {
    assert.equal(dot(m.container), null, "no dot after the version was seen");
  } finally {
    m.cleanup();
  }
});

test("no published entries → no dot", async () => {
  const m = await mount({ publishedVersions: [] });
  try {
    assert.equal(dot(m.container), null);
  } finally {
    m.cleanup();
  }
});

test("visiting /whats-new marks the latest published version as seen (and shows no dot)", async () => {
  const m = await mount({ publishedVersions: ["9.0"], path: "/whats-new" });
  try {
    assert.equal(dot(m.container), null, "no dot while on the What's New page");
    assert.equal(window.localStorage.getItem(SEEN_KEY), "9.0", "seen marker persisted");
  } finally {
    m.cleanup();
  }
});

test("a newer published version re-arms the dot for a device that saw the old one", async () => {
  window.localStorage.setItem(SEEN_KEY, "8.0");
  const m = await mount({ publishedVersions: ["9.0", "8.0"] });
  try {
    assert.ok(dot(m.container), "dot returns when a newer version publishes");
  } finally {
    m.cleanup();
  }
});
