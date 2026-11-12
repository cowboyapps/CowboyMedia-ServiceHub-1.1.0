import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// --- jsdom globals + polyfills (mirrors test/chat-composer.test.ts) -------
// This is a real render test: it mounts the unified Messages page as a
// customer and as an admin and asserts the client-side gating of the
// admin-only tools ("New Conversation", the KB-attach composer button,
// delete-thread, and the "Legacy Sent Messages" section). The server already
// enforces these permissions (see server/message-thread-attachments.test.ts);
// this complements that by locking down the UI so a future refactor can't
// silently expose admin controls to customers.
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
window.scrollTo = () => {};

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

// Visibility reads must only happen after the browser reports an intersecting
// message. Keep observed nodes without eagerly marking anything visible.
class IntersectionObserverStub {
  constructor(private callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) { ioInstances.push(this); }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
  root: Element | Document | null = null;
  rootMargin = "0px";
  thresholds: ReadonlyArray<number> = [];
  report(target: Element, visible: boolean): void {
    this.callback([{
      target,
      isIntersecting: visible,
      intersectionRatio: visible ? 1 : 0,
      intersectionRect: { width: visible ? 1 : 0, height: visible ? 1 : 0 } as DOMRectReadOnly,
      boundingClientRect: target.getBoundingClientRect(),
      rootBounds: null,
      time: Date.now(),
    }], this as unknown as IntersectionObserver);
  }
}
g.IntersectionObserver = IntersectionObserverStub;
w.IntersectionObserver = IntersectionObserverStub;

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

// matchMedia (used by useIsMobile in the thread chat view).
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

function fireViewportResize(): void {
  for (const cb of vvListeners.get("resize") ?? []) cb();
}

function fireOrientationChange(): void {
  window.dispatchEvent(new window.Event("orientationchange"));
}

// The thread chat view opens a reconnecting WebSocket on mount. jsdom has no
// WebSocket; a stub that never fires events keeps the socket in "connecting"
// and the component tree stable for the assertions.
class WebSocketStub {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 3; }
  addEventListener(): void {}
  removeEventListener(): void {}
}
g.WebSocket = WebSocketStub;
w.WebSocket = WebSocketStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Test fixtures + a fetch stub that serves the page's queries ----------
const THREAD_ID = "thread-1";
const ISO = "2026-01-01T00:00:00.000Z";

const CUSTOMER_USER = { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" };
const ADMIN_USER = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };

const THREADS = [
  {
    id: THREAD_ID,
    adminId: "admin-1",
    customerId: "cust-1",
    subject: "Need help with billing",
    createdAt: ISO,
    lastMessageAt: ISO,
    unreadCount: 0,
    adminName: "Avery Admin",
    customerName: "Casey Customer",
    lastMessage: { body: "Hi there", senderId: "cust-1", createdAt: ISO },
  },
];

const THREAD = THREADS[0];

const LEGACY_SENT = [
  { id: "sent-1", senderId: "admin-1", recipientId: "cust-1", subject: "Old broadcast", body: "Legacy one-way note", readAt: null, createdAt: ISO },
];

const USERS = [
  { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" },
  { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" },
];

// Set per-test before mounting so /api/auth/me returns the right identity.
let currentUser: typeof CUSTOMER_USER | typeof ADMIN_USER | null = null;
const sentThreadMessages: FormData[] = [];
let threadMessages: Array<Record<string, unknown>> = [];
let failNextThreadPost = false;
const readBatches: string[][] = [];
const ioInstances: IntersectionObserverStub[] = [];
let profileDurations: number[] | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];

  if (pathname === "/api/auth/me") {
    return currentUser ? jsonResponse(currentUser) : jsonResponse(null, 401);
  }
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/message-threads") return jsonResponse(THREADS);
  if (pathname === "/api/private-messages") return jsonResponse([]);
  if (pathname === "/api/admin/private-messages/sent") return jsonResponse(LEGACY_SENT);
  if (pathname === "/api/admin/users") return jsonResponse(USERS);
  if (/^\/api\/message-threads\/[^/]+\/messages$/.test(pathname)) {
    if (init?.method === "POST" && init.body instanceof FormData) {
      sentThreadMessages.push(init.body);
      if (failNextThreadPost) {
        failNextThreadPost = false;
        return new Response("Payload Too Large", { status: 413 });
      }
      const form = init.body;
      return jsonResponse({ message: {
        id: `message-${sentThreadMessages.length}`, threadId: THREAD_ID,
        senderId: currentUser?.id, body: String(form.get("body") || ""),
        createdAt: ISO, editedAt: null, clientMessageId: String(form.get("clientMessageId") || ""),
        attachment: null, reactions: [],
      } });
    }
    return jsonResponse(threadMessages);
  }
  if (/^\/api\/message-threads\/[^/]+\/read$/.test(pathname)) {
    if (init?.body) {
      try { readBatches.push(JSON.parse(String(init.body)).messageIds || []); } catch {}
    }
    return jsonResponse({});
  }
  if (/^\/api\/message-threads\/[^/]+$/.test(pathname)) return jsonResponse(THREAD);

  // Unknown endpoints: succeed quietly so background mutations don't error.
  return jsonResponse({});
};
after(() => { g.fetch = realFetch; });

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
// messages-page.tsx and auth.tsx rely on Vite's automatic JSX runtime and do
// not import React. Under tsx the JSX compiles to classic `React.createElement`
// calls that resolve `React` from the global scope, so expose it there before
// those modules render.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { queryClient } = await import("../client/src/lib/queryClient");
queryClient.setDefaultOptions({
  ...queryClient.getDefaultOptions(),
  queries: { ...queryClient.getDefaultOptions().queries, queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
  mutations: { ...queryClient.getDefaultOptions().mutations, retry: false, gcTime: 0 },
});
setupComponentTestTeardown({ queryClient, window });
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const MessagesPage = (await import("../client/src/pages/messages-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

async function typeIntoTextarea(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const prototype = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(textarea, value);
  await act(async () => {
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountMessages(path: string, user: typeof CUSTOMER_USER | typeof ADMIN_USER): Promise<MountResult> {
  currentUser = user;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const { hook } = memoryLocation({ path });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          {
            hook,
            children: [
              React.createElement(Route, { key: "m", path: "/messages", component: MessagesPage }),
              React.createElement(Route, { key: "mid", path: "/messages/:id", component: MessagesPage }),
            ],
          },
        ),
      ),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(React.Profiler, {
      id: "conversation",
      onRender: (_id, phase, duration) => { if (phase !== "mount") profileDurations?.push(duration); },
    }, React.createElement(Wrapper)));
  });
  await flush();

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

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

test("performance fixture: typing in a 150-message attachment-heavy private conversation", async () => {
  threadMessages = Array.from({ length: 150 }, (_, i) => ({
    id: `perf-${i}`, threadId: THREAD_ID, senderId: i % 2 ? CUSTOMER_USER.id : ADMIN_USER.id,
    senderName: "Example", body: `Message ${i} https://example.com/help/a-long-address?q=example`,
    createdAt: ISO, readAt: ISO, deliveredAt: ISO, editedAt: null, reactions: [],
    attachment: i % 3 === 0 ? { name: `sample-${i}.mp4`, kind: "video", contentType: "video/mp4" } : null,
  }));
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    const input = h.container.querySelector<HTMLTextAreaElement>('[data-testid="input-thread-message"]')!;
    assert.ok(input);
    const first = h.container.querySelector('[data-testid="message-perf-0"]');
    assert.ok(first);
    profileDurations = [];
    for (let i = 1; i <= 10; i++) await typeIntoTextarea(input, "sampletext".slice(0, i));
    const samples = profileDurations;
    profileDurations = null;
    console.log("CONVERSATION_PROFILE", JSON.stringify({
      messages: 150, keystrokes: 10, updateCommits: samples.length,
      totalRenderMs: +samples.reduce((sum, n) => sum + n, 0).toFixed(2),
      medianRenderMs: +[...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)].toFixed(2),
    }));
    assert.equal(input.value, "sampletext");
    assert.equal(h.container.querySelector('[data-testid="message-perf-0"]'), first, "typing preserves existing bubbles");
    await act(async () => {
      queryClient.setQueryData(["/api/message-threads", THREAD_ID, "messages"],
        threadMessages.map(msg => msg.id === "perf-149" ? { ...msg, body: "Edited example", editedAt: ISO } : msg));
    });
    await flush();
    assert.ok(has("message-edited-perf-149"), "receipts/edits still update cached rows");
    assert.match(h.container.querySelector('[data-testid="message-perf-149"]')!.textContent!, /Edited example/);
  } finally { profileDurations = null; h.cleanup(); threadMessages = []; }
});

// --- List view (/messages) -----------------------------------------------

test("customer at /messages never sees the admin-only tools", async () => {
  const h = await mountMessages("/messages", CUSTOMER_USER);
  try {
    // Sanity: the page rendered the customer's own thread.
    assert.ok(has("text-messages-title"), "messages page rendered");
    assert.ok(has(`card-thread-${THREAD_ID}`), "customer sees their thread");

    // Admin-only tools must be absent.
    assert.equal(has("button-new-conversation"), false, "no New Conversation button for customer");
    assert.equal(has(`button-delete-thread-${THREAD_ID}`), false, "no delete-thread button for customer");
    assert.equal(has("card-legacy-sent-sent-1"), false, "no Legacy Sent Messages card for customer");
  } finally {
    h.cleanup();
  }
});

test("admin at /messages sees the admin-only tools", async () => {
  const h = await mountMessages("/messages", ADMIN_USER);
  try {
    assert.ok(has("text-messages-title"), "messages page rendered");
    assert.ok(has("button-new-conversation"), "admin sees New Conversation button");
    assert.ok(has(`button-delete-thread-${THREAD_ID}`), "admin sees delete-thread button");
    assert.ok(has("card-legacy-sent-sent-1"), "admin sees Legacy Sent Messages card");
  } finally {
    h.cleanup();
  }
});

// --- Thread chat view (/messages/:id) ------------------------------------

test("customer in a thread sees the photo attach button but NOT the KB attach button", async () => {
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    assert.ok(has("thread-chat-view"), "thread chat view rendered");
    assert.ok(has("button-attach-thread-image"), "customer composer keeps the photo attach button");
    assert.equal(has("button-attach-thread-kb"), false, "no KB attach button for customer");
  } finally {
    h.cleanup();
  }
});

test("admin in a thread sees both the photo attach and the KB attach buttons", async () => {
  const h = await mountMessages(`/messages/${THREAD_ID}`, ADMIN_USER);
  try {
    assert.ok(has("thread-chat-view"), "thread chat view rendered");
    assert.ok(has("button-attach-thread-image"), "admin composer has the photo attach button");
    assert.ok(has("button-attach-thread-kb"), "admin composer has the KB attach button");
  } finally {
    h.cleanup();
  }
});

test("private-message composer tracks panned iPhone keyboard through rotation, delayed resize, and close", async () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    const view = h.container.querySelector<HTMLElement>('[data-testid="thread-chat-view"]');
    assert.ok(view, "thread chat view rendered");
    assert.equal(view.style.paddingBottom, "", "closed keyboard adds no padding");

    visualViewportStub.height = 480;
    visualViewportStub.offsetTop = 140;
    await act(async () => fireViewportResize());
    await flush();
    assert.equal(view.style.paddingBottom, "180px", "padding is bottom-edge occlusion, not raw 320px height loss");

    visualViewportStub.height = 450;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flush();
    assert.equal(view.style.paddingBottom, "210px", "delayed measurement picks up the settled viewport");

    Object.defineProperty(window, "innerHeight", { value: 430, configurable: true, writable: true });
    visualViewportStub.height = 300;
    visualViewportStub.offsetTop = 50;
    await act(async () => fireOrientationChange());
    await flush();
    assert.equal(view.style.paddingBottom, "80px", "rotation immediately realigns to the landscape bottom edge");

    visualViewportStub.height = 260;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    await flush();
    assert.equal(view.style.paddingBottom, "120px", "rotation sampling settles to the final landscape occlusion");

    visualViewportStub.height = 430;
    visualViewportStub.offsetTop = 0;
    await act(async () => fireViewportResize());
    await flush();
    assert.equal(view.style.paddingBottom, "", "padding clears when the keyboard closes");
  } finally {
    h.cleanup();
  }
});

test("Enter adds line breaks and only the Send button submits a private message", async () => {
  sentThreadMessages.length = 0;
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    const textarea = h.container.querySelector('[data-testid="input-thread-message"]');
    const sendButton = h.container.querySelector('[data-testid="button-send-thread-message"]');
    assert.ok(textarea instanceof window.HTMLTextAreaElement, "message textarea rendered");
    assert.ok(sendButton instanceof window.HTMLButtonElement, "Send button rendered");

    await typeIntoTextarea(textarea, "first line");

    for (const shiftKey of [false, true]) {
      const enter = new window.KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        textarea.dispatchEvent(enter);
      });
      assert.equal(enter.defaultPrevented, false, `${shiftKey ? "Shift+Enter" : "Enter"} keeps native textarea behavior`);
      assert.equal(sentThreadMessages.length, 0, `${shiftKey ? "Shift+Enter" : "Enter"} does not send`);
    }

    // jsdom does not perform the browser's native newline insertion after a
    // synthetic keydown, so apply the resulting multiline value explicitly.
    await typeIntoTextarea(textarea, "first line\nsecond line");
    textarea.focus();
    await act(async () => {
      sendButton.click();
    });
    await flush();

    assert.equal(sentThreadMessages.length, 1, "Send button submits exactly once");
    assert.equal(sentThreadMessages[0].get("body"), "first line\nsecond line");
    assert.equal(window.document.activeElement, textarea, "successful send keeps keyboard focus without scrolling");
  } finally {
    h.cleanup();
  }
});

test("send failure keeps the draft and retry reuses its clientMessageId", async () => {
  sentThreadMessages.length = 0;
  failNextThreadPost = true;
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    const textarea = h.container.querySelector<HTMLTextAreaElement>('[data-testid="input-thread-message"]');
    const send = h.container.querySelector<HTMLButtonElement>('[data-testid="button-send-thread-message"]');
    assert.ok(textarea && send);
    await typeIntoTextarea(textarea, "Please check the invoice");
    await act(async () => send.click());
    await flush();
    assert.equal(textarea.value, "Please check the invoice", "failed send preserves the draft");
    assert.equal(sentThreadMessages.length, 1);
    const firstId = sentThreadMessages[0].get("clientMessageId");
    assert.ok(firstId, "request carries an idempotency identity");

    await act(async () => send.click());
    await flush();
    assert.equal(sentThreadMessages.length, 2, "retry sends the preserved draft");
    assert.equal(sentThreadMessages[1].get("body"), "Please check the invoice");
    assert.equal(sentThreadMessages[1].get("clientMessageId"), firstId, "retry reuses the same clientMessageId");
    assert.equal(textarea.value, "", "draft clears only after successful response");
  } finally {
    h.cleanup();
  }
});

test("private message menu permits editing only the sender's own message", async () => {
  threadMessages = [
    { id: "own", threadId: THREAD_ID, senderId: "cust-1", senderName: "Casey Customer", body: "My text", createdAt: ISO, editedAt: null, clientMessageId: null, attachment: null, reactions: [] },
    { id: "incoming", threadId: THREAD_ID, senderId: "admin-1", senderName: "Avery Admin", body: "Support reply", createdAt: ISO, editedAt: null, clientMessageId: null, attachment: null, reactions: [] },
  ];
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    await flush();
    const openMenu = async (id: string) => {
      const actions = h.container.querySelector<HTMLElement>(`[data-testid="message-actions-${id}"]`);
      assert.ok(actions);
      await act(async () => actions.dispatchEvent(new window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
      await flush();
      return window.document.querySelector<HTMLElement>(`[data-testid="menu-message-actions-${id}"]`);
    };
    const ownMenu = await openMenu("own");
    assert.ok(ownMenu);
    await flush();
    assert.ok(has("button-edit-message-own"), "sender can edit their own message");
    assert.equal(has("button-delete-message-own"), false, "customer cannot delete for everyone");

    await act(async () => ownMenu.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await flush();
    const incomingMenu = await openMenu("incoming");
    assert.ok(incomingMenu);
    assert.equal(has("button-edit-message-incoming"), false, "customer cannot edit another sender's message");
    assert.equal(has("button-delete-message-incoming"), false, "customer has no delete-for-everyone action");
  } finally {
    threadMessages = [];
    h.cleanup();
  }
});

test("incoming messages are marked read only after the observer reports visible pixels", async () => {
  threadMessages = [
    { id: "incoming-read", threadId: THREAD_ID, senderId: "admin-1", senderName: "Avery Admin", body: "A tall support reply", createdAt: ISO, editedAt: null, clientMessageId: null, attachment: null, reactions: [] },
  ];
  readBatches.length = 0;
  const h = await mountMessages(`/messages/${THREAD_ID}`, CUSTOMER_USER);
  try {
    await flush();
    assert.equal(readBatches.length, 0, "mount alone does not mark messages read");
    const sentinel = h.container.querySelector<HTMLElement>('[data-read-message-id="incoming-read"]');
    assert.ok(sentinel, "unread message has a dedicated visibility sentinel");
    const observer = ioInstances.at(-1);
    assert.ok(observer, "intersection observer is installed");
    await act(async () => {
      observer.report(sentinel, true);
      observer.report(sentinel, false);
    });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    assert.equal(readBatches.length, 0, "a message leaving view before the read flush is cancelled");
    await act(async () => observer.report(sentinel, true));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 400)); });
    await flush();
    assert.deepEqual(readBatches.flat(), ["incoming-read"], "a visible pixel of the tall message is enough to mark it read");
  } finally {
    threadMessages = [];
    h.cleanup();
  }
});
