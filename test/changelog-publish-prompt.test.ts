import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/messages-admin-gating.test.ts) --
// Real render test for the on-open "ready to publish" prompt — the only nudge a
// master admin gets to publish a version-stamped changelog and fire the
// customer "Welcome to version X" popup. A regression that silently stops the
// prompt from showing would mean customers never see release notes, so this
// locks down the gating: it shows for a master admin when an awaiting-publish
// entry exists for the current APP_VERSION (and isn't dismissed), and stays
// hidden for a non-master admin, an already-dismissed version, or no entry.
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
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
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

// Radix's focus-scope (used inside Dialog) observes the DOM for removed nodes.
if (w.MutationObserver !== undefined) {
  g.MutationObserver = w.MutationObserver;
} else {
  class MutationObserverStub implements MutationObserver {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] { return []; }
  }
  g.MutationObserver = MutationObserverStub;
  w.MutationObserver = MutationObserverStub;
}

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

const matchMediaImpl = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
g.matchMedia = matchMediaImpl;
w.matchMedia = matchMediaImpl;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Test fixtures + a fetch stub that serves the component's queries -------
const MASTER_ADMIN = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };
const PLAIN_ADMIN = { id: "admin-2", role: "admin", fullName: "Pat Plain", username: "pat", email: "pat@example.com" };

// Set per-test before mounting.
let currentUser: typeof MASTER_ADMIN | typeof PLAIN_ADMIN | null = null;
let pendingPublish: { version: string; title: string; bodyHtml: string } | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];

  if (pathname === "/api/auth/me") {
    return currentUser ? jsonResponse(currentUser) : jsonResponse(null, 401);
  }
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/admin/changelog/pending-publish") return jsonResponse(pendingPublish);

  // Unknown endpoints: succeed quietly so background mutations don't error.
  return jsonResponse({});
};

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
// changelog-publish-prompt.tsx and auth.tsx rely on Vite's automatic JSX
// runtime and do not import React; under tsx the JSX compiles to classic
// `React.createElement` calls that resolve `React` from the global scope.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { _resetModalQueueForTests } = await import("../client/src/lib/modal-queue");
const { APP_VERSION } = await import("../shared/version");
const { ChangelogPublishPrompt } = await import("../client/src/components/changelog-publish-prompt");

const PENDING_ENTRY = { version: APP_VERSION, title: "Release highlights", bodyHtml: "<ul><li>Something new</li></ul>" };

function dismissKey(userId: string, version: string): string {
  return `changelog-publish-prompt:${userId}:${version}`;
}

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

beforeEach(() => {
  _resetModalQueueForTests();
  currentUser = null;
  pendingPublish = null;
  try {
    window.localStorage.clear();
  } catch {}
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  root: Root;
  cleanup: () => void;
}

async function mountPrompt(user: typeof MASTER_ADMIN | typeof PLAIN_ADMIN): Promise<MountResult> {
  currentUser = user;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const { hook } = memoryLocation({ path: "/" });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          { hook, children: React.createElement(ChangelogPublishPrompt, null) },
        ),
      ),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

test("master admin with an awaiting-publish entry sees the publish prompt", async () => {
  pendingPublish = PENDING_ENTRY;
  const h = await mountPrompt(MASTER_ADMIN);
  try {
    assert.ok(has("dialog-changelog-publish-prompt"), "publish prompt dialog is shown");
    const title = window.document.body.querySelector('[data-testid="text-changelog-publish-prompt-title"]');
    assert.ok(title, "prompt title rendered");
    assert.ok(title!.textContent!.includes(APP_VERSION), "title names the current version");
    assert.ok(has("button-changelog-publish-prompt-publish"), "publish button present");
  } finally {
    h.cleanup();
  }
});

test("non-master admin never sees the publish prompt", async () => {
  pendingPublish = PENDING_ENTRY;
  const h = await mountPrompt(PLAIN_ADMIN);
  try {
    assert.equal(has("dialog-changelog-publish-prompt"), false, "no prompt for a non-master admin");
  } finally {
    h.cleanup();
  }
});

test("publish prompt stays hidden once dismissed for that version", async () => {
  pendingPublish = PENDING_ENTRY;
  window.localStorage.setItem(dismissKey(MASTER_ADMIN.id, APP_VERSION), "1");
  const h = await mountPrompt(MASTER_ADMIN);
  try {
    assert.equal(has("dialog-changelog-publish-prompt"), false, "dismissed version does not re-prompt");
  } finally {
    h.cleanup();
  }
});

test("publish prompt stays hidden when there is no awaiting-publish entry", async () => {
  pendingPublish = null;
  const h = await mountPrompt(MASTER_ADMIN);
  try {
    assert.equal(has("dialog-changelog-publish-prompt"), false, "nothing to publish → no prompt");
  } finally {
    h.cleanup();
  }
});
