import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test", pretendToBeVisual: true });
const window = dom.window;
Object.assign(globalThis, {
  window, document: window.document, navigator: window.navigator,
  getComputedStyle: window.getComputedStyle.bind(window),
  IS_REACT_ACT_ENVIRONMENT: true,
  requestAnimationFrame: (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0),
  cancelAnimationFrame: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
});
for (const name of ["HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Document", "DocumentFragment", "ShadowRoot", "MutationObserver", "Event", "CustomEvent", "MouseEvent", "FocusEvent", "NodeFilter"]) {
  Object.assign(globalThis, { [name]: (window as unknown as Record<string, unknown>)[name] });
}
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { createRoot } = await import("react-dom/client");
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { CommunityMessageActions } = await import("../client/src/components/community/community-message-actions");
const { CommunityPhoto } = await import("../client/src/components/community/community-photo");
const { CommunityPinnedBanner, COMMUNITY_PIN_QUERY_KEY } = await import("../client/src/components/community/community-pinned-banner");
const { CommunitySearch } = await import("../client/src/components/community/community-search");
setupComponentTestTeardown({ queryClient, window });

async function settle() {
  await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function mounted(component: React.ReactElement, run: (container: HTMLElement) => Promise<void>) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await React.act(async () => root.render(React.createElement(QueryClientProvider, { client: queryClient }, component)));
    await run(container);
  } finally {
    await React.act(async () => root.unmount());
    container.remove();
    queryClient.clear();
  }
}
const actions = {
  id: "one", content: "A helpful message", reactions: [], userId: "customer",
  canReply: true, canEdit: true, canDelete: false, canPin: false, pinned: false,
  onReply() {}, onEdit() {}, onDelete() {}, onReact() {},
};
async function openMenu(container: HTMLElement) {
  await React.act(async () => {
    container.querySelector('[aria-label="Message actions"]')!.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  await settle();
}

test("customer actions offer copy, reply, edit and reactions without admin controls", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { copied = text; } } });
  await mounted(React.createElement(CommunityMessageActions, actions, React.createElement("p", null, actions.content)), async container => {
    await openMenu(container);
    assert.ok(document.querySelector('[data-testid="button-edit-one"]'));
    assert.ok(document.querySelector('[data-testid="button-reply"]'));
    assert.ok(Array.from(document.querySelectorAll('[role="menuitem"]')).some(item => item.getAttribute("data-testid") === "button-emoji-👍"));
    assert.equal(document.querySelector('[data-testid="button-delete-one"]'), null);
    assert.equal(document.querySelector('[data-testid="button-pin-message-one"]'), null);
    await React.act(async () => (document.querySelector('[data-testid="button-copy-message-one"]') as HTMLElement).click());
    assert.equal(copied, actions.content);
  });
});

test("admin menu keeps destructive actions explicit and performs pinning through the API", async () => {
  const fetchBefore = globalThis.fetch;
  let pinnedBody = "";
  let deletes = 0;
  globalThis.fetch = async (_url, options) => {
    pinnedBody = String(options?.body);
    assert.equal(options?.method, "PUT");
    return new Response(JSON.stringify({ message: { id: "one" } }), { status: 200 });
  };
  try {
    await mounted(React.createElement(CommunityMessageActions, { ...actions, canDelete: true, canPin: true, onDelete: () => { deletes++; } }), async container => {
      await openMenu(container);
      assert.ok(document.querySelector('[data-testid="button-delete-one"]'));
      assert.equal(deletes, 0, "opening the menu never deletes a message");
      await React.act(async () => (document.querySelector('[data-testid="button-pin-message-one"]') as HTMLElement).click());
      await settle();
      assert.deepEqual(JSON.parse(pinnedBody), { messageId: "one" });
      assert.equal(deletes, 0);
    });
  } finally { globalThis.fetch = fetchBefore; }
});

test("moving a touch cancels long press, while holding still opens message actions", async () => {
  await mounted(React.createElement(CommunityMessageActions, actions, React.createElement("p", null, actions.content)), async container => {
    const row = container.querySelector('[data-testid="message-actions-one"]')!;
    const pointer = (type: string, x: number) => row.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: 10 }));
    await React.act(async () => { pointer("pointerdown", 10); pointer("pointermove", 35); await new Promise(resolve => setTimeout(resolve, 620)); });
    assert.equal(document.querySelector('[data-testid="menu-message-actions-one"]'), null);
    await React.act(async () => { pointer("pointerdown", 10); await new Promise(resolve => setTimeout(resolve, 620)); pointer("pointerup", 10); });
    assert.ok(document.querySelector('[data-testid="menu-message-actions-one"]'));
  });
});

test("community photo opens in a viewer and saves a typed image download", async () => {
  const fetchBefore = globalThis.fetch;
  const clickBefore = window.HTMLAnchorElement.prototype.click;
  let downloaded = "";
  let revoked = "";
  Object.assign(URL, { createObjectURL: () => "blob:test-photo", revokeObjectURL: (url: string) => { revoked = url; } });
  window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download; };
  globalThis.fetch = async (_url, options) => {
    assert.equal(options?.cache, "no-store");
    return new Response(new Blob(["image"], { type: "image/png" }));
  };
  try {
    await mounted(React.createElement(CommunityPhoto, { src: "/uploads/photo.png", messageId: "one" }), async container => {
      await React.act(async () => (container.querySelector('[aria-label="Open shared photo"]') as HTMLElement).click());
      assert.ok(document.querySelector('[data-testid="community-photo-viewer-one"]'));
      await React.act(async () => (document.querySelector('[data-testid="button-save-community-photo-one"]') as HTMLElement).click());
      assert.equal(downloaded, "community-photo-one.png");
      await React.act(async () => (document.querySelector('[aria-label="Close image preview"]') as HTMLElement).click());
      assert.equal(document.querySelector('[data-testid="community-photo-viewer-one"]'), null);
    });
    await new Promise(resolve => setTimeout(resolve, 1050));
    assert.equal(revoked, "blob:test-photo");
  } finally {
    globalThis.fetch = fetchBefore;
    window.HTMLAnchorElement.prototype.click = clickBefore;
  }
});

test("an admin can unpin an old message directly from the banner", async () => {
  const fetchBefore = globalThis.fetch;
  let deleted = false;
  queryClient.setQueryData(COMMUNITY_PIN_QUERY_KEY, { message: { id: "old", chatUsername: "Admin", content: "Community guidelines" } });
  globalThis.fetch = async (_url, options) => {
    if (options?.method === "DELETE") deleted = true;
    return new Response(JSON.stringify({ message: null }), { status: 200 });
  };
  try {
    await mounted(React.createElement(CommunityPinnedBanner, { canManage: true, onPreview() {} }), async container => {
      assert.match(container.textContent!, /Community guidelines/);
      await React.act(async () => (container.querySelector('[aria-label="Unpin community message"]') as HTMLElement).click());
      await settle();
      assert.equal(deleted, true);
      assert.equal(container.querySelector('[data-testid="community-pinned-banner"]'), null);
    });
  } finally { globalThis.fetch = fetchBefore; }
});

test("search waits for a usable term, opens matching message details, and can close", async () => {
  const fetchBefore = globalThis.fetch;
  let calls = 0;
  let previewId = "";
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.match(String(url), /search\?q=welcome&limit=25/);
    assert.ok(options?.signal, "closing search can cancel its request");
    return new Response(JSON.stringify({ messages: [{
      id: "old", chatUsername: "Subscriber", content: "Welcome",
      createdAt: "2026-01-01T12:00:00Z", imageUrl: null,
    }], truncated: false }), { status: 200 });
  };
  try {
    await mounted(React.createElement(CommunitySearch, { onPreview: message => { previewId = message.id; } }), async container => {
      await React.act(async () => (container.querySelector('[data-testid="button-open-community-search"]') as HTMLElement).click());
      assert.equal(calls, 0);
      const input = container.querySelector("input")!;
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, "welcome");
        input.dispatchEvent(new window.Event("input", { bubbles: true }));
      });
      await React.act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
      await settle();
      assert.equal(calls, 1);
      await React.act(async () => (container.querySelector('[data-testid="community-search-result-old"]') as HTMLElement).click());
      assert.equal(previewId, "old");
      await React.act(async () => (container.querySelector('[data-testid="button-close-community-search"]') as HTMLElement).click());
      assert.equal(container.querySelector("input"), null);
    });
  } finally { globalThis.fetch = fetchBefore; }
});
