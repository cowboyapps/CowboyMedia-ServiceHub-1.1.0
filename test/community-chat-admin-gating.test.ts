import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/messages-admin-gating.test.ts) -
// This is a real render test: it mounts the Community Chat page as a customer
// and as an admin and asserts the client-side gating of the admin-only tools:
// the composer's "Link KB article" + "Post a poll" buttons, and the per-message
// moderation menu (Delete Message / Warn User / Ban from Chat / Review
// Customer) that only opens when an admin taps another user's name. The server
// already enforces these permissions; this complements that by locking down the
// UI so a future refactor can't silently expose moderation controls to
// customers.
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
  "MutationObserver",
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

// matchMedia (used by useIsMobile in the chat header dialogs).
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

// URL.createObjectURL is referenced for the (unused) pending-image preview.
const URLCtor = window.URL as unknown as { createObjectURL?: () => string; revokeObjectURL?: () => void };
URLCtor.createObjectURL ??= () => "blob:stub";
URLCtor.revokeObjectURL ??= () => {};

// The page opens a reconnecting WebSocket on mount. jsdom has no WebSocket; a
// stub that never fires events keeps the socket "connecting" and the tree
// stable for the assertions.
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
const ISO = "2026-01-01T00:00:00.000Z";

const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com", chatUsername: "casey", chatNotifications: "mentions", chatBanned: false,
};
const ADMIN_USER = {
  id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery",
  email: "avery@example.com", chatUsername: null, chatNotifications: "all", chatBanned: false,
};

// A message from a *different* non-admin user, so it renders the clickable
// username (only !isMe first-in-run messages do) and is a valid moderation
// target (admins can't moderate other admins).
const OTHER_MSG = {
  id: "msg-1",
  userId: "cust-2",
  chatUsername: "OtherCustomer",
  content: "Hello everyone",
  imageUrl: null,
  pollId: null,
  kbArticle: null,
  createdAt: ISO,
  reactions: [],
  isAdmin: false,
};

// Two edited messages: one edited before the history feature shipped (no
// recorded rows → hasEditHistory false) and one with real history rows. The
// "(edited)" label must only be a tappable button for admins when history
// actually exists.
const EDITED_NO_HISTORY_MSG = {
  ...OTHER_MSG,
  id: "msg-2",
  content: "Edited long ago",
  editedAt: ISO,
  hasEditHistory: false,
  editCount: 0,
};
const EDITED_WITH_HISTORY_MSG = {
  ...OTHER_MSG,
  id: "msg-3",
  content: "Edited recently",
  editedAt: ISO,
  hasEditHistory: true,
  editCount: 3,
};

const PARTICIPANTS = [{ username: "OtherCustomer", isAdmin: false }];

// Set per-test before mounting so /api/auth/me returns the right identity.
let currentUser: typeof CUSTOMER_USER | typeof ADMIN_USER | null = null;

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
  if (pathname === "/api/community-chat/messages") return jsonResponse([OTHER_MSG, EDITED_NO_HISTORY_MSG, EDITED_WITH_HISTORY_MSG]);
  if (pathname === "/api/community-chat/participants") return jsonResponse(PARTICIPANTS);
  if (/^\/api\/community-chat\/messages\/[^/]+\/history$/.test(pathname)) {
    // Only the admin harness should ever reach this endpoint; the customer
    // UI must never render a control that triggers it.
    return jsonResponse({
      current: { content: "Edited recently", editedAt: ISO },
      edits: [
        { id: "hist-1", previousContent: "Original wording", editedByUsername: "OtherCustomer", createdAt: ISO },
      ],
    });
  }
  if (/^\/api\/users\/[^/]+\/profile$/.test(pathname)) {
    return jsonResponse({
      id: "cust-2", fullName: "Other Customer", chatUsername: "OtherCustomer",
      avatarUrl: null, bio: null, memberSince: null, badges: [], ticketCount: 0,
    });
  }

  // Unknown endpoints (e.g. profile snapshot opened by the customer's profile
  // dialog) succeed quietly so background fetches don't error.
  return jsonResponse({});
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
// community-chat-page.tsx imports React, but auth.tsx relies on Vite's
// automatic JSX runtime and does not import React. Under tsx the JSX compiles
// to classic `React.createElement` calls that resolve `React` from the global
// scope, so expose it there before those modules render.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const CommunityChatPage = (await import("../client/src/pages/community-chat-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountChat(user: typeof CUSTOMER_USER | typeof ADMIN_USER): Promise<MountResult> {
  currentUser = user;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const { hook } = memoryLocation({ path: "/community" });

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
            children: React.createElement(Route, { path: "/community", component: CommunityChatPage }),
          },
        ),
      ),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
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

async function clickTestId(id: string): Promise<void> {
  const el = window.document.body.querySelector(`[data-testid="${id}"]`);
  assert.ok(el instanceof window.HTMLElement, `element ${id} present to click`);
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flush();
}

// --- Composer tools ------------------------------------------------------

// The attach tools live inside a "+" dropdown menu (Radix). Open it the way a
// real pointer does: a mouse-pointerType pointerdown on the trigger.
async function openAttachMenu(): Promise<void> {
  const trigger = window.document.body.querySelector(
    `[data-testid="button-composer-attach-menu"]`,
  );
  assert.ok(trigger instanceof window.HTMLElement, "attach menu trigger present");
  await act(async () => {
    trigger.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        pointerType: "mouse",
        button: 0,
      }),
    );
  });
  await flush();
}

test("customer in community chat sees the photo attach tool but NOT the KB-link or poll tools", async () => {
  const h = await mountChat(CUSTOMER_USER);
  try {
    assert.ok(has("community-chat-page"), "community chat page rendered");
    assert.ok(has(`community-message-${OTHER_MSG.id}`), "message rendered");

    await openAttachMenu();
    // Customer keeps the photo attach tool...
    assert.ok(has("button-attach-community-image"), "customer keeps the photo attach tool");
    // ...but the admin-only composer tools must be absent.
    assert.equal(has("button-attach-kb-article"), false, "no KB-link tool for customer");
    assert.equal(has("button-open-poll-composer"), false, "no poll composer tool for customer");
  } finally {
    h.cleanup();
  }
});

test("admin in community chat sees the KB-link and poll composer tools", async () => {
  const h = await mountChat(ADMIN_USER);
  try {
    assert.ok(has("community-chat-page"), "community chat page rendered");
    await openAttachMenu();
    assert.ok(has("button-attach-community-image"), "admin has the photo attach tool");
    assert.ok(has("button-attach-kb-article"), "admin sees the KB-link tool");
    assert.ok(has("button-open-poll-composer"), "admin sees the poll composer tool");
  } finally {
    h.cleanup();
  }
});

// --- "(edited)" label gating ----------------------------------------------

function editedLabelTag(id: string): string | null {
  const el = window.document.body.querySelector(`[data-testid="label-edited-${id}"]`);
  return el ? el.tagName : null;
}

function editedLabelText(id: string): string | null {
  const el = window.document.body.querySelector(`[data-testid="label-edited-${id}"]`);
  return el ? (el.textContent ?? "").trim() : null;
}

test("admin sees a tappable (edited) label only when edit history exists", async () => {
  const h = await mountChat(ADMIN_USER);
  try {
    assert.equal(editedLabelTag(EDITED_WITH_HISTORY_MSG.id), "BUTTON", "history exists → tappable button");
    assert.equal(editedLabelText(EDITED_WITH_HISTORY_MSG.id), "(edited ×3)", "admin sees the edit count at a glance");
    assert.equal(editedLabelTag(EDITED_NO_HISTORY_MSG.id), "SPAN", "no history rows → plain label");
    assert.equal(editedLabelText(EDITED_NO_HISTORY_MSG.id), "(edited)", "no recorded rows → plain (edited)");
    assert.equal(editedLabelTag(OTHER_MSG.id), null, "unedited message shows no label");
  } finally {
    h.cleanup();
  }
});

test("customer never sees a tappable (edited) label", async () => {
  const h = await mountChat(CUSTOMER_USER);
  try {
    assert.equal(editedLabelTag(EDITED_WITH_HISTORY_MSG.id), "SPAN", "history exists but customer gets plain label");
    assert.equal(editedLabelText(EDITED_WITH_HISTORY_MSG.id), "(edited)", "customer never sees the count");
    assert.equal(editedLabelTag(EDITED_NO_HISTORY_MSG.id), "SPAN", "no history → plain label");
  } finally {
    h.cleanup();
  }
});

// --- "View edit history" control + dialog gating ---------------------------

test("admin can open the edit-history dialog from the (edited) button", async () => {
  const h = await mountChat(ADMIN_USER);
  try {
    const btn = window.document.body.querySelector(
      `[data-testid="label-edited-${EDITED_WITH_HISTORY_MSG.id}"]`,
    );
    assert.ok(btn instanceof window.HTMLElement, "(edited) control present for admin");
    assert.equal(btn.tagName, "BUTTON", "control is a button");
    assert.equal(btn.getAttribute("title"), "View edit history", "button is the View edit history control");

    await clickTestId(`label-edited-${EDITED_WITH_HISTORY_MSG.id}`);
    assert.ok(has("dialog-edit-history"), "clicking opens the edit-history dialog");
    assert.ok(
      window.document.body.textContent?.includes("Original wording"),
      "dialog shows the fetched history row",
    );
  } finally {
    h.cleanup();
  }
});

test("customer never sees the View edit history control or dialog", async () => {
  const h = await mountChat(CUSTOMER_USER);
  try {
    // No element anywhere on the page carries the View edit history affordance.
    assert.equal(
      window.document.body.querySelector('[title="View edit history"]'),
      null,
      "no View edit history control for customer",
    );

    // The (edited) label exists but is inert — clicking it opens nothing.
    const label = window.document.body.querySelector(
      `[data-testid="label-edited-${EDITED_WITH_HISTORY_MSG.id}"]`,
    );
    assert.ok(label instanceof window.HTMLElement, "plain (edited) label present");
    await act(async () => {
      (label as HTMLElement).click();
    });
    await flush();
    assert.equal(has("dialog-edit-history"), false, "edit-history dialog never opens for customer");
  } finally {
    h.cleanup();
  }
});

// --- Per-message moderation menu -----------------------------------------

test("customer tapping another user's name does NOT open the admin moderation menu", async () => {
  const h = await mountChat(CUSTOMER_USER);
  try {
    assert.ok(has(`button-username-${OTHER_MSG.id}`), "username is tappable");
    await clickTestId(`button-username-${OTHER_MSG.id}`);

    // For a customer the tap opens the reply popup (Reply + View Profile),
    // never the moderation menu or any of its destructive actions.
    assert.ok(has("dialog-reply-actions"), "customer tap opens the reply popup");
    assert.ok(has("button-reply"), "reply popup has a Reply action");
    assert.ok(has("button-view-profile"), "reply popup has a View Profile action");
    assert.equal(has("dialog-admin-actions"), false, "no admin actions menu for customer");
    assert.equal(has("button-admin-delete-msg"), false, "no delete-message action for customer");
    assert.equal(has("button-admin-warn-user"), false, "no warn-user action for customer");
    assert.equal(has("button-admin-ban-user"), false, "no ban-user action for customer");
  } finally {
    h.cleanup();
  }
});

test("admin tapping another user's name opens the moderation menu with delete/warn/ban/review", async () => {
  const h = await mountChat(ADMIN_USER);
  try {
    assert.ok(has(`button-username-${OTHER_MSG.id}`), "username is tappable");
    await clickTestId(`button-username-${OTHER_MSG.id}`);

    assert.ok(has("dialog-admin-actions"), "admin sees the moderation menu");
    assert.ok(has("button-review-customer"), "admin sees Review Customer");
    assert.ok(has("button-admin-delete-msg"), "admin sees Delete Message");
    assert.ok(has("button-admin-warn-user"), "admin sees Warn User");
    assert.ok(has("button-admin-ban-user"), "admin sees Ban from Chat");
  } finally {
    h.cleanup();
  }
});
