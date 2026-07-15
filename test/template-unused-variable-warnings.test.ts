import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// React render coverage for the "unused variable" warnings on the two template
// editors in the Admin Portal (client/src/pages/admin-portal.tsx):
//   - EmailTemplatesTab: amber badge + hint appear only on CUSTOMIZED rows that
//     miss available `{placeholders}`, never on default rows.
//   - NotificationTemplatesTab: same, but only when the row is customized AND
//     enabled (disabled rows fall back to default wording, so no warning).
//   - Edit dialog: the unused-variables notice renders while a variable is
//     missing and disappears live as the variable is typed/inserted.
//   - One-click insert: clicking a variable badge appends `{var}` to the body.
// Without this coverage, a regression (warnings on non-customized rows, or no
// warnings at all) would ship silently.

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/admin?tab=email-templates",
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

// No test here fires a real network write; GETs are served from seeded cache.
// A resilient stub avoids surprise refetch crashes.
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
g.fetch = (async () => jsonResponse([])) as unknown as typeof fetch;
w.fetch = g.fetch;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const {
  EmailTemplatesTab,
  NotificationTemplatesTab,
  getUnusedTemplateVariables,
  getUnusedNotificationVariables,
  getUnknownTemplateTokens,
  replaceTemplateToken,
} = await import("../client/src/pages/admin-portal");
const { suggestClosestVariable } = await import("../shared/quick-response-vars");

setupComponentTestTeardown({ queryClient, window });

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

// Dialogs portal into document.body, so look there.
function bodyByTestId(id: string): HTMLElement | null {
  return window.document.body.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

function fireClick(el: Element): void {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}

// React overrides the native value setter on controlled inputs; go through the
// prototype setter + an input event so onChange fires with the new value.
function setNativeValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = Object.getPrototypeOf(el) as object;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, value);
  el.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
}

// --- fixtures ---------------------------------------------------------------

function emailTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "et-1",
    templateKey: "welcome",
    name: "Welcome Email",
    subject: "Welcome, {username}!",
    body: "<p>Hello {username}</p>",
    availableVariables: ["username", "app_url"],
    description: "Sent after registration",
    enabled: true,
    customized: false,
    ...over,
  };
}

function notifTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "nt-1",
    templateKey: "invoice_created",
    group: "Invoice",
    label: "Invoice created",
    description: "Fires when a new invoice is generated",
    variables: [
      { name: "invoice_number", description: "The invoice number" },
      { name: "amount", description: "Amount due" },
    ],
    defaultTitle: "New invoice {invoice_number}",
    defaultBody: "Amount due: {amount}",
    title: "New invoice {invoice_number}",
    body: "Amount due: {amount}",
    enabled: true,
    customized: false,
    ...over,
  };
}

interface Mount { container: HTMLElement; root: Root; cleanup: () => void }

async function mountTab(el: React.ReactElement): Promise<Mount> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, el));
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

async function mountEmailTab(templates: Record<string, unknown>[]): Promise<Mount> {
  queryClient.setQueryData(["/api/admin/email-templates"], templates);
  return mountTab(React.createElement(EmailTemplatesTab, { canManage: true }));
}

async function mountNotifTab(templates: Record<string, unknown>[]): Promise<Mount> {
  queryClient.setQueryData(["/api/admin/notification-templates"], templates);
  return mountTab(React.createElement(NotificationTemplatesTab, { canManage: true }));
}

// --- pure helper coverage -----------------------------------------------

test("getUnusedTemplateVariables flags only placeholders missing from subject+body", () => {
  const tpl = { availableVariables: ["username", "app_url", "code"] };
  assert.deepEqual(getUnusedTemplateVariables(tpl, "Hi {username}", "Use {code} now"), ["app_url"]);
  assert.deepEqual(getUnusedTemplateVariables(tpl, "Hi {username}", "{app_url} {code}"), []);
  assert.deepEqual(getUnusedTemplateVariables({ availableVariables: null }, "x", "y"), []);
});

test("getUnusedNotificationVariables flags only placeholders missing from title+body", () => {
  const tpl = { variables: [{ name: "invoice_number" }, { name: "amount" }] };
  assert.deepEqual(getUnusedNotificationVariables(tpl, "Invoice {invoice_number}", "no amount here"), ["amount"]);
  assert.deepEqual(getUnusedNotificationVariables(tpl, "Invoice {invoice_number}", "{amount}"), []);
});

// --- email templates list -------------------------------------------------

test("email list: badge + hint only on customized rows with unused variables", async () => {
  const c = await mountEmailTab([
    // Default row missing {app_url}: NO warning (defaults are trusted).
    emailTemplate({ id: "et-1", templateKey: "welcome", customized: false }),
    // Customized row missing {app_url}: warning badge + hint.
    emailTemplate({ id: "et-2", templateKey: "reset", name: "Reset", customized: true }),
    // Customized row using everything: NO warning.
    emailTemplate({
      id: "et-3", templateKey: "verify", name: "Verify", customized: true,
      body: "<p>{username} go to {app_url}</p>",
    }),
  ]);
  try {
    assert.equal(byTestId(c.container, "badge-unused-vars-welcome"), null, "no badge on non-customized row");
    assert.equal(byTestId(c.container, "text-unused-vars-welcome"), null, "no hint on non-customized row");

    const badge = byTestId(c.container, "badge-unused-vars-reset");
    assert.ok(badge, "badge on customized row with unused variable");
    assert.match(badge!.textContent ?? "", /1 new variable available/);
    const hint = byTestId(c.container, "text-unused-vars-reset");
    assert.ok(hint, "hint on customized row with unused variable");
    assert.match(hint!.textContent ?? "", /\{app_url\}/);

    assert.equal(byTestId(c.container, "badge-unused-vars-verify"), null, "no badge when all variables used");
  } finally {
    c.cleanup();
  }
});

test("email list: plural badge copy when several variables are unused", async () => {
  const c = await mountEmailTab([
    emailTemplate({
      templateKey: "welcome", customized: true,
      subject: "Welcome!", body: "<p>Hello there</p>",
    }),
  ]);
  try {
    const badge = byTestId(c.container, "badge-unused-vars-welcome");
    assert.ok(badge);
    assert.match(badge!.textContent ?? "", /2 variables unused/);
  } finally {
    c.cleanup();
  }
});

// --- email edit dialog ------------------------------------------------------

test("email edit dialog: notice appears, and clears when the variable is inserted via one-click badge", async () => {
  const c = await mountEmailTab([emailTemplate({ templateKey: "welcome", customized: true })]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();

    const notice = bodyByTestId("notice-unused-variables");
    assert.ok(notice, "unused-variable notice visible in edit dialog");
    assert.match(notice!.textContent ?? "", /\{app_url\}/);

    // One-click insert: clicking the variable badge inserts the placeholder
    // into the body at the cursor position without losing existing content.
    fireClick(bodyByTestId("badge-var-app_url")!);
    await flushFrames();

    const ta = bodyByTestId("textarea-template-body") as HTMLTextAreaElement;
    assert.ok(ta.value.includes("{app_url}"), "one-click insert added {app_url} to the body");
    assert.ok(ta.value.includes("Hello {username}"), "existing body content preserved");

    assert.equal(bodyByTestId("notice-unused-variables"), null, "notice clears once the variable is used");
  } finally {
    c.cleanup();
  }
});

test("email edit dialog: notice reacts live to typing in the body", async () => {
  const c = await mountEmailTab([emailTemplate({ templateKey: "welcome", customized: true })]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();
    assert.ok(bodyByTestId("notice-unused-variables"), "notice starts visible");

    const ta = bodyByTestId("textarea-template-body") as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(ta, "<p>Hello {username}, visit {app_url}</p>");
    });
    await flushFrames();
    assert.equal(bodyByTestId("notice-unused-variables"), null, "notice gone after typing the variable");

    // Remove it again: notice returns.
    await act(async () => {
      setNativeValue(bodyByTestId("textarea-template-body") as HTMLTextAreaElement, "<p>Hello {username}</p>");
    });
    await flushFrames();
    assert.ok(bodyByTestId("notice-unused-variables"), "notice returns when the variable is removed");
  } finally {
    c.cleanup();
  }
});

// --- notification templates list -------------------------------------------

test("notification list: badge + hint only on customized AND enabled rows with unused variables", async () => {
  const c = await mountNotifTab([
    // Customized + enabled, missing {amount}: warning.
    notifTemplate({
      id: "nt-1", templateKey: "invoice_created", customized: true,
      title: "New invoice {invoice_number}", body: "Pay up",
    }),
    // Customized but DISABLED (default wording is used): no warning.
    notifTemplate({
      id: "nt-2", templateKey: "invoice_paid", label: "Invoice paid",
      customized: true, enabled: false,
      title: "Paid {invoice_number}", body: "Thanks",
    }),
    // Not customized, missing nothing to warn about: no warning.
    notifTemplate({ id: "nt-3", templateKey: "invoice_refunded", label: "Invoice refunded", customized: false, body: "no vars here", title: "none" }),
  ]);
  try {
    const badge = byTestId(c.container, "badge-notif-unused-vars-invoice_created");
    assert.ok(badge, "badge on customized+enabled row");
    assert.match(badge!.textContent ?? "", /1 new variable available/);
    const hint = byTestId(c.container, "text-notif-unused-vars-invoice_created");
    assert.ok(hint, "hint on customized+enabled row");
    assert.match(hint!.textContent ?? "", /\{amount\}/);

    assert.equal(byTestId(c.container, "badge-notif-unused-vars-invoice_paid"), null, "no badge on disabled row");
    assert.equal(byTestId(c.container, "text-notif-unused-vars-invoice_paid"), null, "no hint on disabled row");
    assert.equal(byTestId(c.container, "badge-notif-unused-vars-invoice_refunded"), null, "no badge on non-customized row");
  } finally {
    c.cleanup();
  }
});

// --- notification edit dialog ------------------------------------------------

test("notification edit dialog: notice appears and clears via one-click insert", async () => {
  const c = await mountNotifTab([
    notifTemplate({
      templateKey: "invoice_created", customized: true,
      title: "New invoice {invoice_number}", body: "Pay up",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-notif-template-invoice_created")!);
    await flushFrames();

    const notice = bodyByTestId("notice-notif-unused-variables");
    assert.ok(notice, "unused-variable notice visible in notification edit dialog");
    assert.match(notice!.textContent ?? "", /\{amount\}/);

    // The variable badge shows the "(not used)" marker while unused.
    const varBadge = bodyByTestId("badge-notif-var-amount");
    assert.ok(varBadge);
    assert.match(varBadge!.textContent ?? "", /not used/);

    fireClick(varBadge!);
    await flushFrames();

    const ta = bodyByTestId("textarea-notif-template-body") as HTMLTextAreaElement;
    assert.ok(ta.value.includes("{amount}"), "one-click insert added {amount} to the body");
    assert.equal(bodyByTestId("notice-notif-unused-variables"), null, "notice clears once the variable is used");
    assert.doesNotMatch(
      bodyByTestId("badge-notif-var-amount")!.textContent ?? "",
      /not used/,
      "'(not used)' marker clears after insert",
    );
  } finally {
    c.cleanup();
  }
});

test("notification edit dialog: notice reacts live to typing in the title", async () => {
  const c = await mountNotifTab([
    notifTemplate({
      templateKey: "invoice_created", customized: true,
      title: "New invoice", body: "Amount due: {amount}",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-notif-template-invoice_created")!);
    await flushFrames();
    assert.ok(bodyByTestId("notice-notif-unused-variables"), "notice starts visible (missing {invoice_number})");

    const title = bodyByTestId("input-notif-template-title") as HTMLInputElement;
    await act(async () => {
      setNativeValue(title, "New invoice {invoice_number}");
    });
    await flushFrames();
    assert.equal(bodyByTestId("notice-notif-unused-variables"), null, "notice gone after typing the variable in the title");
  } finally {
    c.cleanup();
  }
});

// --- unknown (misspelled) placeholder detection ------------------------------

test("getUnknownTemplateTokens flags word-only {tokens} missing from the known list", () => {
  assert.deepEqual(getUnknownTemplateTokens(["username", "app_url"], "Hi {usrname}", "{app_url} {user_name}"), ["usrname", "user_name"]);
  assert.deepEqual(getUnknownTemplateTokens(["username"], "Hi {username}", "all good"), []);
  // Dedupes repeats across fields.
  assert.deepEqual(getUnknownTemplateTokens([], "{oops}", "{oops} again"), ["oops"]);
  // Ignores CSS/JSON-style braces (non-word content) and double braces content is still word-only inner match.
  assert.deepEqual(getUnknownTemplateTokens(["username"], "", "<style>p { color: red; }</style> {username}"), []);
  // Empty/undefined-ish inputs are safe.
  assert.deepEqual(getUnknownTemplateTokens(["a"], "", ""), []);
});

test("email list: unknown-token badge + hint only on customized rows with a misspelled placeholder", async () => {
  const c = await mountEmailTab([
    // Default row with a bogus token: NO warning (defaults are trusted).
    emailTemplate({ id: "et-1", templateKey: "welcome", customized: false, subject: "Hi {usrname}" }),
    // Customized row with a typo: red badge + hint.
    emailTemplate({
      id: "et-2", templateKey: "reset", name: "Reset", customized: true,
      subject: "Reset, {usrname}!", body: "<p>{username} {app_url}</p>",
    }),
    // Customized row with only valid tokens: NO warning.
    emailTemplate({
      id: "et-3", templateKey: "verify", name: "Verify", customized: true,
      body: "<p>{username} go to {app_url}</p>",
    }),
  ]);
  try {
    assert.equal(byTestId(c.container, "badge-unknown-tokens-welcome"), null, "no badge on non-customized row");

    const badge = byTestId(c.container, "badge-unknown-tokens-reset");
    assert.ok(badge, "badge on customized row with unknown token");
    assert.match(badge!.textContent ?? "", /1 unknown placeholder/);
    const hint = byTestId(c.container, "text-unknown-tokens-reset");
    assert.ok(hint, "hint on customized row with unknown token");
    assert.match(hint!.textContent ?? "", /\{usrname\}/);
    assert.match(hint!.textContent ?? "", /raw text/);

    assert.equal(byTestId(c.container, "badge-unknown-tokens-verify"), null, "no badge when all tokens are known");
  } finally {
    c.cleanup();
  }
});

test("email list: plural unknown-token badge copy for several typos", async () => {
  const c = await mountEmailTab([
    emailTemplate({
      templateKey: "welcome", customized: true,
      subject: "Hi {usrname}", body: "<p>{username} {app_url} {appurl}</p>",
    }),
  ]);
  try {
    const badge = byTestId(c.container, "badge-unknown-tokens-welcome");
    assert.ok(badge);
    assert.match(badge!.textContent ?? "", /2 unknown placeholders/);
  } finally {
    c.cleanup();
  }
});

test("notification list: unknown-token badge + hint only on customized AND enabled rows", async () => {
  const c = await mountNotifTab([
    // Customized + enabled with a typo: warning.
    notifTemplate({
      id: "nt-1", templateKey: "invoice_created", customized: true,
      title: "New invoice {invoice_numbr}", body: "Amount due: {amount} {invoice_number}",
    }),
    // Customized but DISABLED (default wording used): no warning.
    notifTemplate({
      id: "nt-2", templateKey: "invoice_paid", label: "Invoice paid",
      customized: true, enabled: false,
      title: "Paid {invoice_numbr}", body: "{amount} {invoice_number}",
    }),
    // Not customized: no warning even with a bogus token.
    notifTemplate({
      id: "nt-3", templateKey: "invoice_refunded", label: "Invoice refunded",
      customized: false, title: "Refund {invoice_numbr}", body: "{amount} {invoice_number}",
    }),
  ]);
  try {
    const badge = byTestId(c.container, "badge-notif-unknown-tokens-invoice_created");
    assert.ok(badge, "badge on customized+enabled row");
    assert.match(badge!.textContent ?? "", /1 unknown placeholder/);
    const hint = byTestId(c.container, "text-notif-unknown-tokens-invoice_created");
    assert.ok(hint, "hint on customized+enabled row");
    assert.match(hint!.textContent ?? "", /\{invoice_numbr\}/);

    assert.equal(byTestId(c.container, "badge-notif-unknown-tokens-invoice_paid"), null, "no badge on disabled row");
    assert.equal(byTestId(c.container, "badge-notif-unknown-tokens-invoice_refunded"), null, "no badge on non-customized row");
  } finally {
    c.cleanup();
  }
});

test("email edit dialog: unknown-token notice appears for a typo'd placeholder and clears when fixed", async () => {
  const c = await mountEmailTab([
    emailTemplate({ templateKey: "welcome", customized: true, subject: "Welcome, {usrname}!", body: "<p>Hello {username} {app_url}</p>" }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();

    const notice = bodyByTestId("notice-unknown-tokens");
    assert.ok(notice, "unknown-token notice visible in edit dialog");
    assert.match(notice!.textContent ?? "", /\{usrname\}/);
    assert.match(notice!.textContent ?? "", /raw text/);

    // Fix the typo in the subject: notice clears.
    const subject = bodyByTestId("input-template-subject") as HTMLInputElement;
    await act(async () => {
      setNativeValue(subject, "Welcome, {username}!");
    });
    await flushFrames();
    assert.equal(bodyByTestId("notice-unknown-tokens"), null, "notice gone after fixing the typo");

    // Typing a new bogus token in the body brings it back.
    const ta = bodyByTestId("textarea-template-body") as HTMLTextAreaElement;
    await act(async () => {
      setNativeValue(ta, "<p>Hello {username} {app_url} {appurl}</p>");
    });
    await flushFrames();
    const again = bodyByTestId("notice-unknown-tokens");
    assert.ok(again, "notice returns for a new unknown token in the body");
    assert.match(again!.textContent ?? "", /\{appurl\}/);
  } finally {
    c.cleanup();
  }
});

// --- "did you mean?" suggestion + one-click fix -------------------------------

test("suggestClosestVariable suggests the unique near-miss and stays quiet otherwise", () => {
  assert.equal(suggestClosestVariable("usrname", ["username", "app_url"]), "username");
  assert.equal(suggestClosestVariable("user_name", ["username", "app_url"]), "username");
  assert.equal(suggestClosestVariable("appurl", ["username", "app_url"]), "app_url");
  assert.equal(suggestClosestVariable("invoice_numbr", ["invoice_number", "amount"]), "invoice_number");
  // Way off: no suggestion.
  assert.equal(suggestClosestVariable("zzzzz", ["username", "app_url"]), null);
  // Empty inputs are safe.
  assert.equal(suggestClosestVariable("", ["username"]), null);
  assert.equal(suggestClosestVariable("usrname", []), null);
});

test("replaceTemplateToken swaps every exact {token} occurrence and nothing else", () => {
  assert.equal(replaceTemplateToken("Hi {usrname}, {usrname}!", "usrname", "username"), "Hi {username}, {username}!");
  assert.equal(replaceTemplateToken("Hi {usrname2}", "usrname", "username"), "Hi {usrname2}");
  assert.equal(replaceTemplateToken("", "a", "b"), "");
});

test("email edit dialog: unknown-token notice offers a suggestion and one click fixes subject+body", async () => {
  const c = await mountEmailTab([
    emailTemplate({
      templateKey: "welcome", customized: true,
      subject: "Welcome, {usrname}!", body: "<p>Hello {usrname}, visit {app_url}</p>",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();

    const notice = bodyByTestId("notice-unknown-tokens");
    assert.ok(notice, "unknown-token notice visible");
    assert.match(notice!.textContent ?? "", /Did you mean/);

    const fix = bodyByTestId("button-fix-token-usrname");
    assert.ok(fix, "suggestion button rendered");
    assert.match(fix!.textContent ?? "", /\{username\}/);

    fireClick(fix!);
    await flushFrames();

    const subject = bodyByTestId("input-template-subject") as HTMLInputElement;
    const ta = bodyByTestId("textarea-template-body") as HTMLTextAreaElement;
    assert.equal(subject.value, "Welcome, {username}!", "typo replaced in the subject");
    assert.equal(ta.value, "<p>Hello {username}, visit {app_url}</p>", "typo replaced in the body");
    assert.equal(bodyByTestId("notice-unknown-tokens"), null, "notice clears after the one-click fix");
  } finally {
    c.cleanup();
  }
});

test("email edit dialog: no suggestion button when the typo isn't a near-miss", async () => {
  const c = await mountEmailTab([
    emailTemplate({
      templateKey: "welcome", customized: true,
      subject: "Welcome!", body: "<p>Hello {username} {totally_bogus}</p>",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();

    const notice = bodyByTestId("notice-unknown-tokens");
    assert.ok(notice, "unknown-token notice still shown");
    assert.doesNotMatch(notice!.textContent ?? "", /Did you mean/, "no confident suggestion offered");
    assert.equal(bodyByTestId("button-fix-token-totally_bogus"), null);
  } finally {
    c.cleanup();
  }
});

test("notification edit dialog: suggestion click fixes the typo in title+body", async () => {
  const c = await mountNotifTab([
    notifTemplate({
      templateKey: "invoice_created", customized: true,
      title: "New invoice {invoice_numbr}", body: "Invoice {invoice_numbr}: {amount}",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-notif-template-invoice_created")!);
    await flushFrames();

    const fix = bodyByTestId("button-fix-notif-token-invoice_numbr");
    assert.ok(fix, "suggestion button rendered in notification dialog");
    assert.match(fix!.textContent ?? "", /\{invoice_number\}/);

    fireClick(fix!);
    await flushFrames();

    const title = bodyByTestId("input-notif-template-title") as HTMLInputElement;
    const ta = bodyByTestId("textarea-notif-template-body") as HTMLTextAreaElement;
    assert.equal(title.value, "New invoice {invoice_number}", "typo replaced in the title");
    assert.equal(ta.value, "Invoice {invoice_number}: {amount}", "typo replaced in the body");
    assert.equal(bodyByTestId("notice-notif-unknown-tokens"), null, "notice clears after the fix");
  } finally {
    c.cleanup();
  }
});

test("email edit dialog: no unknown-token notice when all placeholders are valid", async () => {
  const c = await mountEmailTab([
    emailTemplate({ templateKey: "welcome", customized: true, body: "<p>Hello {username}, visit {app_url}</p>" }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-template-welcome")!);
    await flushFrames();
    assert.equal(bodyByTestId("notice-unknown-tokens"), null, "no notice when every token is known");
  } finally {
    c.cleanup();
  }
});

test("notification edit dialog: unknown-token notice appears for a typo'd placeholder and clears when removed", async () => {
  const c = await mountNotifTab([
    notifTemplate({
      templateKey: "invoice_created", customized: true,
      title: "New invoice {invoice_numbr}", body: "Amount due: {amount} {invoice_number}",
    }),
  ]);
  try {
    fireClick(byTestId(c.container, "button-edit-notif-template-invoice_created")!);
    await flushFrames();

    const notice = bodyByTestId("notice-notif-unknown-tokens");
    assert.ok(notice, "unknown-token notice visible in notification edit dialog");
    assert.match(notice!.textContent ?? "", /\{invoice_numbr\}/);
    assert.match(notice!.textContent ?? "", /raw text/);

    const title = bodyByTestId("input-notif-template-title") as HTMLInputElement;
    await act(async () => {
      setNativeValue(title, "New invoice {invoice_number}");
    });
    await flushFrames();
    assert.equal(bodyByTestId("notice-notif-unknown-tokens"), null, "notice gone after fixing the typo");
  } finally {
    c.cleanup();
  }
});
