import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/tickets/ticket-1",
});
const { window } = dom;
const originalFormData = globalThis.FormData;
globalThis.FormData = window.FormData as unknown as typeof FormData;
type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;
g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.getComputedStyle = window.getComputedStyle.bind(window);

for (const key of [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement", "Element", "Node",
  "Document", "DocumentFragment", "ShadowRoot", "Event", "CustomEvent",
  "MouseEvent", "PointerEvent", "FocusEvent", "KeyboardEvent", "InputEvent",
  "MessageEvent", "NodeFilter", "DOMException", "MutationObserver",
] as const) {
  if (w[key] !== undefined) g[key] = w[key];
}

const rafImpl: typeof requestAnimationFrame = (cb) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
const cafImpl: typeof cancelAnimationFrame = (id) =>
  clearTimeout(id as unknown as NodeJS.Timeout);
g.requestAnimationFrame = rafImpl;
g.cancelAnimationFrame = cafImpl;
w.requestAnimationFrame = rafImpl;
w.cancelAnimationFrame = cafImpl;
window.scrollTo = () => {};

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

const proto = window.HTMLElement.prototype as HTMLElement & {
  scrollIntoView?: () => void;
  hasPointerCapture?: () => boolean;
  setPointerCapture?: () => void;
  releasePointerCapture?: () => void;
};
proto.scrollIntoView ??= () => {};
proto.hasPointerCapture ??= () => false;
proto.setPointerCapture ??= () => {};
proto.releasePointerCapture ??= () => {};

const matchMediaImpl = (query: string) => ({
  matches: false, media: query, onchange: null,
  addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  dispatchEvent() { return false; },
});
g.matchMedia = matchMediaImpl;
w.matchMedia = matchMediaImpl;

Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
type VvListener = () => void;
const vvListeners = new Map<string, Set<VvListener>>();
const visualViewportStub = {
  height: 800,
  offsetTop: 0,
  addEventListener(type: string, cb: VvListener) {
    if (!vvListeners.has(type)) vvListeners.set(type, new Set());
    vvListeners.get(type)!.add(cb);
  },
  removeEventListener(type: string, cb: VvListener) {
    vvListeners.get(type)?.delete(cb);
  },
};
Object.defineProperty(window, "visualViewport", { value: visualViewportStub, configurable: true });
const fireViewportResize = () => {
  for (const cb of vvListeners.get("resize") ?? []) cb();
};
const fireOrientationChange = () => {
  window.dispatchEvent(new window.Event("orientationchange"));
};

class WebSocketStub {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 0;
  onopen = null; onmessage = null; onclose = null; onerror = null;
  send(): void {}
  close(): void { this.readyState = 3; }
  addEventListener(): void {}
  removeEventListener(): void {}
}
g.WebSocket = WebSocketStub;
w.WebSocket = WebSocketStub;
g.IS_REACT_ACT_ENVIRONMENT = true;

const USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer",
  username: "casey", email: "casey@example.com",
};
const TICKET = {
  id: "ticket-1", subject: "Keyboard spacing", description: "Please help",
  serviceId: null, categoryId: null, status: "open", priority: "medium",
  customerId: "cust-1", claimedBy: null, imageUrl: null, resolutionNote: null,
  closedBy: null, createdAt: "2026-09-08T00:00:00.000Z", closedAt: null,
};
let activeUser = USER;
let claimedBy: string | null = null;
let serverMessages: Array<Record<string, unknown>> = [];
let pendingReply: ((response: Response) => void) | undefined;
let failReply = false;
let failEdit = false;
let editRequests = 0;

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}
const realFetch = globalThis.fetch;
g.fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
  const path = (typeof input === "string" ? input : String((input as { url?: string }).url ?? input)).split("?")[0];
  if (path.startsWith("/api/tickets/ticket-1/messages/") && init?.method === "PATCH") {
    editRequests++;
    if (failEdit) return new Response(JSON.stringify({ message: "Couldn't save. Try again." }), { status: 500 });
    const payload = JSON.parse(init.body as string);
    const id = path.split("/").at(-1);
    const existing = serverMessages.find(message => message.id === id)!;
    const updated = { ...existing, message: payload.message.trim() };
    serverMessages = serverMessages.map(message => message.id === id ? updated : message);
    return jsonResponse(updated);
  }
  if (path === "/api/auth/me") return jsonResponse(activeUser);
  if (path === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (path === "/api/tickets/ticket-1") return jsonResponse({ ...TICKET, claimedBy });
  if (path === "/api/tickets/ticket-1/customer") return jsonResponse({ customer: USER, ticket: TICKET });
  if (path === "/api/tickets/ticket-1/messages") {
    if (init?.method === "POST") {
      if (failReply) return new Response("Send failed", { status: 500 });
      return new Promise<Response>(resolve => { pendingReply = resolve; });
    }
    return jsonResponse(serverMessages);
  }
  if (path === "/api/services" || path === "/api/ticket-categories") return jsonResponse([]);
  if (path === "/api/business-hours/status") return jsonResponse({ isOpen: true });
  if (/suggestions|quick-responses/.test(path)) return jsonResponse([]);
  return jsonResponse({});
};

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { queryClient: ticketQueryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const TicketDetail = (await import("../client/src/pages/ticket-detail")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 0)); });
  }
}

test("ticket-detail composer tracks panned iPhone keyboard through rotation, delayed resize, and close", async () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const { hook } = memoryLocation({ path: "/tickets/ticket-1" });
  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: queryClient },
        React.createElement(AuthProvider, null,
          React.createElement(Router, {
            hook,
            children: React.createElement(Route, { path: "/tickets/:id", component: TicketDetail }),
          }),
        ),
      ),
    );
  });
  await flush();

  try {
    const view = container.querySelector<HTMLElement>('[data-testid="ticket-detail-view"]');
    assert.ok(view, "ticket detail rendered");
    assert.equal(view.style.paddingBottom, "", "jsdom drops the unsupported CSS env() closed-state value");

    visualViewportStub.height = 480;
    visualViewportStub.offsetTop = 140;
    await act(async () => fireViewportResize());
    await flush();
    assert.equal(view.style.paddingBottom, "180px", "uses bottom-edge occlusion instead of raw 320px loss");

    visualViewportStub.height = 450;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await flush();
    assert.equal(view.style.paddingBottom, "210px", "delayed resize settles to the latest bottom edge");

    Object.defineProperty(window, "innerHeight", { value: 430, configurable: true, writable: true });
    visualViewportStub.height = 300;
    visualViewportStub.offsetTop = 50;
    await act(async () => fireOrientationChange());
    await flush();
    assert.equal(view.style.paddingBottom, "80px", "orientation change immediately uses the landscape bottom edge");

    visualViewportStub.height = 260;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await flush();
    assert.equal(view.style.paddingBottom, "120px", "orientation sampling settles to the final landscape occlusion");

    visualViewportStub.height = 430;
    visualViewportStub.offsetTop = 0;
    await act(async () => fireViewportResize());
    await flush();
    // jsdom rejects CSS env() assignments and leaves the previous valid inline
    // padding serialized. The transition branch still proves the rendered
    // component returned to keyboardInset=0 (real browsers accept env()).
    assert.equal(view.style.transition, "padding-bottom 150ms ease-out", "keyboard-open state clears on close");
  } finally {
    act(() => root.unmount());
    queryClient.clear();
    container.remove();
  }
});

for (const admin of [false, true]) {
  test(`${admin ? "admin" : "customer"} sends follow committed text/attachments with keyboard open and Latest is available for older history`, async () => {
    activeUser = { ...USER, id: admin ? "admin-1" : USER.id, role: admin ? "master_admin" : "customer" };
    claimedBy = admin ? activeUser.id : null;
    serverMessages = Array.from({ length: 12 }, (_, index) => ({
      id: `old-${index}`, ticketId: TICKET.id, senderId: "support", senderName: "Support",
      message: `Older reply ${index}`, createdAt: "2026-09-08T00:00:00Z", isInternal: false,
      imageUrl: null, readAt: null, reactions: [],
    }));
    visualViewportStub.height = 470;
    visualViewportStub.offsetTop = 0;
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    const container = window.document.createElement("div");
    window.document.body.append(container);
    const defaults = ticketQueryClient.getDefaultOptions();
    ticketQueryClient.setDefaultOptions({
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    });
    const { hook } = memoryLocation({ path: "/tickets/ticket-1" });
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(React.createElement(QueryClientProvider, { client: ticketQueryClient },
          React.createElement(AuthProvider, null,
            React.createElement(Router, { hook, children: React.createElement(Route, { path: "/tickets/:id", component: TicketDetail }) }))));
      });
      await flush();
      const pane = container.querySelector<HTMLElement>('[data-testid="ticket-message-scroll"]')!;
      const editor = container.querySelector<HTMLTextAreaElement>('[data-testid="input-message"]')!;
      assert.ok(pane && editor);
      let viewport = 200, top = 0, mediaGrowth = 0;
      const height = () => 100 + pane.querySelectorAll('[data-testid^="message-old-"],[data-testid^="message-optimistic-"],[data-testid^="message-saved-"]').length * 100 + mediaGrowth;
      Object.defineProperties(pane, {
        clientHeight: { get: () => viewport },
        scrollHeight: { get: height },
        scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(value, height() - viewport)); } },
      });
      await act(async () => window.dispatchEvent(new window.Event("resize")));
      await flush();
      assert.equal(top, height() - viewport);
      const browse = async () => {
        top = 100;
        await act(async () => pane.dispatchEvent(new window.Event("scroll")));
        assert.ok(container.querySelector('[data-testid="button-new-messages"]'), "scrolling older history reveals Latest without incoming messages");
      };
      const type = async (value: string) => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, value);
        await act(async () => editor.dispatchEvent(new window.Event("input", { bubbles: true })));
      };
      await act(async () => editor.focus());
      for (const [index, extension] of ["text", "png", "mp4", "pdf"].entries()) {
        await browse();
        await type(extension === "text" ? "A new outgoing reply" : "");
        if (extension !== "text") {
          // Multipart requests are mocked, but the actual composer/file/send
          // and optimistic-to-saved render path are exercised.
          const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
          const file = new window.File(["fixture"], `reply.${extension}`, { type: "application/octet-stream" });
          Object.defineProperty(input, "files", { configurable: true, value: { 0: file, length: 1, item: () => file } });
          await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
        }
        await act(async () => (container.querySelector('[data-testid="button-send-message"]') as HTMLButtonElement).click());
        await flush();
        assert.equal(top, height() - viewport, "optimistic bubble is visible before the POST completes");
        assert.equal(window.document.activeElement, editor);
        assert.ok(pendingReply);
        const saved = {
          id: `saved-${index}`, ticketId: TICKET.id, senderId: activeUser.id, senderName: activeUser.fullName,
          message: extension === "text" ? "A new outgoing reply" : "", createdAt: new Date().toISOString(),
          imageUrl: extension === "text" ? null : `/uploads/reply.${extension}`, isInternal: false, readAt: null, reactions: [],
        };
        serverMessages = [...serverMessages, saved];
        await act(async () => { pendingReply!(jsonResponse(saved)); pendingReply = undefined; });
        await flush();
        assert.ok(pane.querySelector(`[data-testid="message-${saved.id}"]`));
        assert.equal(pane.querySelectorAll('[data-testid^="message-optimistic-"]').length, 0);
        mediaGrowth += 150;
        await act(async () => pane.querySelector("img")?.dispatchEvent(new window.Event("load")));
        await act(async () => window.dispatchEvent(new window.Event("resize")));
        await flush();
        assert.equal(top, height() - viewport, "settled attachment geometry stays visible");
        assert.equal(editor.value, "");
      }
      const openActions = async (id: string) => {
        const wrapper = pane.querySelector(`[data-testid="message-actions-${id}"]`)!;
        await act(async () => wrapper.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
        await flush();
        return window.document.querySelector<HTMLElement>(`[data-testid="menu-message-actions-${id}"]`)!;
      };
      const otherMenu = await openActions("old-0");
      assert.ok(otherMenu);
      assert.equal(otherMenu.querySelector('[data-testid^="button-edit-message-"]'), null, "customer/other-admin messages cannot be edited");
      await act(async () => otherMenu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      await flush();
      const ownMenu = await openActions("saved-0");
      const editItem = ownMenu.querySelector<HTMLElement>('[data-testid="button-edit-message-saved-0"]');
      if (admin) {
        assert.ok(editItem);
        assert.ok(ownMenu.querySelector('[data-testid="button-copy-message-saved-0"]'));
        assert.ok(ownMenu.querySelector('[data-testid="button-delete-message-saved-0"]'));
        await act(async () => editItem.click());
        await flush();
        const editInput = () => window.document.querySelector<HTMLTextAreaElement>('[data-testid="input-edit-ticket-message"]')!;
        assert.equal(editInput().value, "A new outgoing reply");
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editInput(), "Cancelled edit");
        await act(async () => editInput().dispatchEvent(new window.Event("input", { bubbles: true })));
        const beforeCancel = editRequests;
        await act(async () => (window.document.querySelector('[data-testid="button-cancel-edit-ticket-message"]') as HTMLButtonElement).click());
        await flush();
        assert.equal(editRequests, beforeCancel);
        assert.equal(serverMessages.find(message => message.id === "saved-0")!.message, "A new outgoing reply");
        await openActions("saved-0");
        await act(async () => (window.document.querySelector('[data-testid="button-edit-message-saved-0"]') as HTMLElement).click());
        await flush();
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(editInput(), "Corrected sent reply");
        await act(async () => editInput().dispatchEvent(new window.Event("input", { bubbles: true })));
        failEdit = true;
        await act(async () => (window.document.querySelector('[data-testid="button-save-edit-ticket-message"]') as HTMLButtonElement).click());
        await flush();
        assert.equal(editInput().value, "Corrected sent reply", "failed save retains the edit draft");
        assert.ok(window.document.querySelector('#ticket-edit-error'));
        failEdit = false;
        await act(async () => (window.document.querySelector('[data-testid="button-save-edit-ticket-message"]') as HTMLButtonElement).click());
        await flush();
        assert.equal(window.document.querySelector('[data-testid="dialog-edit-ticket-message"]'), null);
        assert.match(pane.querySelector('[data-testid="message-saved-0"]')!.textContent!, /Corrected sent reply/);
        assert.equal(pane.querySelectorAll('[data-testid="message-saved-0"]').length, 1);
      } else {
        assert.equal(editItem, null, "customers cannot edit even their own sent replies");
        await act(async () => ownMenu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
        await flush();
      }
      await browse();
      await type("Retry this reply");
      failReply = true;
      await act(async () => (container.querySelector('[data-testid="button-send-message"]') as HTMLButtonElement).click());
      await flush();
      const retry = container.querySelector<HTMLButtonElement>('[data-testid^="button-retry-"]');
      assert.ok(retry, "failed outgoing reply stays retryable");
      failReply = false;
      await browse();
      await act(async () => retry.click());
      await flush();
      assert.equal(top, height() - viewport, "retry follows even without adding a new optimistic row");
      const savedRetry = {
        ...serverMessages[0], id: "saved-retry", senderId: activeUser.id, senderName: activeUser.fullName,
        message: "Retry this reply", createdAt: new Date().toISOString(),
      };
      serverMessages = [...serverMessages, savedRetry];
      await act(async () => { pendingReply!(jsonResponse(savedRetry)); pendingReply = undefined; });
      await flush();
      assert.equal(pane.querySelectorAll('[data-testid^="message-optimistic-"]').length, 0);
      await browse();
      const incoming = { ...serverMessages[0], id: "old-new-incoming", message: "New reply while reading history" };
      await act(async () => {
        ticketQueryClient.setQueryData<Array<Record<string, unknown>>>(["/api/tickets", TICKET.id, "messages"], [...serverMessages, incoming]);
      });
      await flush();
      assert.equal(top, 100, "incoming replies must not steal older-history position");
      const latest = container.querySelector<HTMLButtonElement>('[data-testid="button-new-messages"]')!;
      assert.match(latest.getAttribute("aria-label")!, /New messages available/);
      await act(async () => latest.click());
      await flush();
      assert.equal(top, height() - viewport);
      assert.equal(container.querySelector('[data-testid="button-new-messages"]'), null);
      assert.equal(window.document.activeElement, editor);
      viewport = 110; // Android resize + short phone landscape
      visualViewportStub.height = 390;
      Object.defineProperty(window, "innerHeight", { value: 390, configurable: true, writable: true });
      await act(async () => fireOrientationChange());
      await flush();
      assert.equal(top, height() - viewport);
      assert.equal(window.scrollY, 0);
    } finally {
      act(() => root.unmount());
      ticketQueryClient.clear();
      ticketQueryClient.setDefaultOptions(defaults);
      container.remove();
      pendingReply = undefined;
      failReply = false;
      failEdit = false;
      activeUser = USER;
      claimedBy = null;
      serverMessages = [];
    }
  });
}

after(() => {
  g.fetch = realFetch;
  globalThis.FormData = originalFormData;
  window.close();
});