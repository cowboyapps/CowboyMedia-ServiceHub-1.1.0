import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React render coverage for the KnowledgeBaseTab draft/publish workflow
// (client/src/pages/admin-portal.tsx): admin article rows must show a
// Published/Draft status badge, a status filter must narrow the list, and the
// edit dialog must offer explicit "Save as Draft" / "Publish" actions instead
// of an ambiguous published toggle — so nothing is published by accident.

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/admin?tab=knowledge-base",
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

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { KnowledgeBaseTab } = await import("../client/src/pages/admin-portal");

// Drop gc timers to 0 so cache entries created by the mutation tests (via
// invalidateQueries refetch + mutation cache) are collected on unmount instead
// of pinning the process open for the default 5min gcTime. Leave staleTime
// untouched — the app's Infinity default keeps preloaded setQueryData from being
// refetched into the wrong (empty) shape mid-test.
queryClient.setDefaultOptions({ queries: { gcTime: 0 }, mutations: { gcTime: 0 } });

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

function byTestId(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

type Article = {
  id: string;
  categoryId: string;
  title: string;
  slug: string;
  summary: string | null;
  bodyHtml: string;
  tags: string[];
  published: boolean;
  sortOrder: number;
  viewCount: number;
  helpfulCount: number;
  unhelpfulCount: number;
  createdAt: string;
  updatedAt: string;
};

function article(overrides: Partial<Article> = {}): Article {
  return {
    id: "a-1",
    categoryId: "cat-1",
    title: "Getting started",
    slug: "getting-started",
    summary: null,
    bodyHtml: "<p>hello</p>",
    tags: [],
    published: true,
    sortOrder: 0,
    viewCount: 0,
    helpfulCount: 0,
    unhelpfulCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

const CATEGORIES = [{ id: "cat-1", name: "General", slug: "general", description: null, sortOrder: 0 }];

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountKbTab(articles: Article[]): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/admin/kb/categories"], CATEGORIES);
  queryClient.setQueryData(["/api/admin/kb/articles"], articles);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(KnowledgeBaseTab),
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

test("each article row shows a Published/Draft status badge", async () => {
  const c = await mountKbTab([
    article({ id: "pub", title: "Published one", slug: "pub", published: true }),
    article({ id: "drf", title: "Draft one", slug: "drf", published: false }),
  ]);
  try {
    const pub = byTestId(c.container, "badge-kb-status-pub");
    const drf = byTestId(c.container, "badge-kb-status-drf");
    assert.ok(pub, "published row renders a status badge");
    assert.ok(drf, "draft row renders a status badge");
    assert.match(pub!.textContent ?? "", /Published/);
    assert.match(drf!.textContent ?? "", /Draft/);
  } finally {
    c.cleanup();
  }
});

test("Drafts filter narrows the list to unpublished articles only", async () => {
  const c = await mountKbTab([
    article({ id: "pub", title: "Published one", slug: "pub", published: true }),
    article({ id: "drf", title: "Draft one", slug: "drf", published: false }),
  ]);
  try {
    assert.ok(byTestId(c.container, "card-admin-kb-article-pub"), "published card visible under All");
    assert.ok(byTestId(c.container, "card-admin-kb-article-drf"), "draft card visible under All");

    const draftsBtn = byTestId(c.container, "filter-kb-articles-draft");
    assert.ok(draftsBtn, "Drafts filter renders");
    assert.match(draftsBtn!.textContent ?? "", /Drafts \(1\)/);
    await act(async () => {
      draftsBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    assert.equal(byTestId(c.container, "card-admin-kb-article-pub"), null, "published card hidden under Drafts");
    assert.ok(byTestId(c.container, "card-admin-kb-article-drf"), "draft card still visible under Drafts");
  } finally {
    c.cleanup();
  }
});

test("Published filter with no published articles shows the empty-filter message", async () => {
  const c = await mountKbTab([
    article({ id: "drf", title: "Draft one", slug: "drf", published: false }),
  ]);
  try {
    const pubBtn = byTestId(c.container, "filter-kb-articles-published");
    assert.ok(pubBtn);
    assert.match(pubBtn!.textContent ?? "", /Published \(0\)/);
    await act(async () => {
      pubBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const empty = byTestId(c.container, "text-kb-articles-empty-filter");
    assert.ok(empty, "empty-filter message renders");
    assert.match(empty!.textContent ?? "", /No published articles/);
  } finally {
    c.cleanup();
  }
});

test("each row exposes a preview link to the customer-facing article", async () => {
  const c = await mountKbTab([article({ id: "pub", slug: "getting-started", published: true })]);
  try {
    const link = byTestId(c.container, "link-preview-kb-article-pub") as HTMLAnchorElement | null;
    assert.ok(link, "preview link renders");
    assert.equal(link!.getAttribute("href"), "/knowledge/getting-started");
    assert.ok(byTestId(c.container, "button-preview-kb-article-pub"), "preview button renders");
  } finally {
    c.cleanup();
  }
});

// Each save action's onSuccess closes the dialog, so drive one button per mount.
async function captureSaveWrite(buttonTestId: string): Promise<{ method: string; body: unknown } | undefined> {
  const calls: Array<{ method: string; body: unknown }> = [];
  const origFetch = g.fetch;
  const capture = (async (_input: unknown, init?: { method?: string; body?: string }) => {
    if (init && (init.method === "PATCH" || init.method === "POST")) {
      calls.push({ method: init.method, body: init.body ? JSON.parse(init.body) : null });
      return jsonResponse({ id: "drf" });
    }
    // GET refetches (post-mutation invalidation) must stay array-shaped.
    return jsonResponse([]);
  }) as unknown as typeof fetch;
  g.fetch = capture;
  w.fetch = capture;

  const c = await mountKbTab([article({ id: "drf", title: "Draft one", slug: "drf", published: false })]);
  try {
    await act(async () => {
      byTestId(c.container, "button-edit-kb-article-drf")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();
    await act(async () => {
      byTestId(window.document, buttonTestId)!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();
    return calls[0];
  } finally {
    g.fetch = origFetch;
    w.fetch = origFetch;
    c.cleanup();
  }
}

test("Save as Draft sends published:false (nothing publishes by accident)", async () => {
  const call = await captureSaveWrite("button-save-kb-article-draft");
  assert.ok(call, "Save as Draft issues a write");
  assert.equal(call!.method, "PATCH");
  assert.equal((call!.body as { published?: boolean }).published, false);
});

test("Publish sends published:true", async () => {
  const call = await captureSaveWrite("button-publish-kb-article");
  assert.ok(call, "Publish issues a write");
  assert.equal(call!.method, "PATCH");
  assert.equal((call!.body as { published?: boolean }).published, true);
});

test("editing an article opens a dialog with explicit Save as Draft + Publish actions (no ambiguous toggle)", async () => {
  const c = await mountKbTab([article({ id: "drf", title: "Draft one", slug: "drf", published: false })]);
  try {
    const editBtn = byTestId(c.container, "button-edit-kb-article-drf");
    assert.ok(editBtn, "edit button renders");
    await act(async () => {
      editBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const doc = window.document;
    assert.ok(byTestId(doc, "button-save-kb-article-draft"), "Save as Draft action present");
    assert.ok(byTestId(doc, "button-publish-kb-article"), "Publish action present");
    assert.equal(byTestId(doc, "switch-kb-article-published"), null, "old ambiguous published toggle removed");
    const status = byTestId(doc, "badge-kb-dialog-status");
    assert.ok(status, "dialog shows current status");
    assert.match(status!.textContent ?? "", /Draft/);
  } finally {
    c.cleanup();
  }
});
