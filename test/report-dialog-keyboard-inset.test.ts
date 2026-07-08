import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the dialog-shift side of useKeyboardInset:
// the report/request page's fixed-centered dialogs shift up by half the
// keyboard inset (top: calc(50% - inset/2)) and cap their height
// (maxHeight: calc(100dvh - inset - 2rem), overflowY auto) so every form
// field stays reachable while typing on iOS. The bottom-nav side is pinned
// by test/bottom-nav-keyboard-inset.test.ts and the composer-padding side
// by test/chat-composer-keyboard-inset.test.ts; this file pins the
// dialog-shift consumer by mounting the real ReportRequestPage, opening a
// dialog, driving a stubbed visualViewport through keyboard
// open/resize/close, and asserting the inline top/maxHeight shift is
// applied and removed accordingly.
// Harness + visualViewport stub mirror test/chat-composer-keyboard-inset.test.ts.
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
  "KeyboardEvent", "InputEvent", "MessageEvent", "NodeFilter", "DOMException",
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

const URLCtor = window.URL as unknown as { createObjectURL?: () => string; revokeObjectURL?: () => void };
URLCtor.createObjectURL ??= () => "blob:stub";
URLCtor.revokeObjectURL ??= () => {};

// Fixed layout viewport height for the inset math:
// inset = window.innerHeight - visualViewport.height - visualViewport.offsetTop.
Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });

// --- Controllable visualViewport stub ---------------------------------------
// useKeyboardInset treats anything <= 80px as browser-chrome jitter (inset 0).
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
Object.defineProperty(window, "visualViewport", {
  value: visualViewportStub,
  configurable: true,
});

function fireViewportResize(): void {
  for (const cb of vvListeners.get("resize") ?? []) cb();
}

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures + fetch stub ----------------------------------------------------
const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com",
};

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

  if (pathname === "/api/auth/me") return jsonResponse(CUSTOMER_USER);
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/services") return jsonResponse([]);
  if (pathname === "/api/report-requests") return jsonResponse([]);
  if (pathname === "/api/report-notifications/mark-read") return jsonResponse({ ok: true });
  if (pathname === "/api/report-notifications/unread-count") return jsonResponse({ count: 0 });
  if (pathname === "/api/notifications/unread-count") return jsonResponse({ count: 0 });
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
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient, getQueryFn } = await import("../client/src/lib/queryClient");
queryClient.setDefaultOptions({
  queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
  mutations: { retry: false, gcTime: 0 },
});
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const ReportRequestPage = (await import("../client/src/pages/report-request-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  cleanup: () => void;
}

async function mountPage(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.clear();

  const { hook } = memoryLocation({ path: "/report" });

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
            children: React.createElement(Route, { path: "/report", component: ReportRequestPage }),
          },
        ),
      ),
    );

  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

async function openAppIssueDialog(): Promise<HTMLElement> {
  const button = window.document.body.querySelector<HTMLElement>(
    '[data-testid="button-report-app-issue"]',
  );
  assert.ok(button, "report app issue button rendered");
  await act(async () => {
    button!.click();
  });
  await flush();
  const dialog = window.document.body.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(dialog, "report dialog opened");
  return dialog!;
}

// jsdom's cssstyle serializer normalizes calc() expressions (e.g. it can
// re-emit `- 2rem` as `+ 2rem` per CSS calc simplification rules). Compare
// the dialog's serialized style against the SOURCE calc string round-tripped
// through the same jsdom setter, so the assertion pins the value the page
// actually sets rather than the serializer's quirks.
function serializedMaxHeight(source: string): string {
  const probe = window.document.createElement("div");
  probe.style.maxHeight = source;
  assert.notEqual(probe.style.maxHeight, "", `probe must parse: ${source}`);
  return probe.style.maxHeight;
}

async function setKeyboardCoverage(px: number): Promise<void> {
  visualViewportStub.height = 800 - px;
  await act(async () => {
    fireViewportResize();
  });
  await flush();
}

test("open report dialog shifts up and caps its height while the keyboard is open, and resets when it closes", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { cleanup } = await mountPage();
  try {
    const dialog = await openAppIssueDialog();

    // Keyboard closed: no inline keyboard shift on the dialog.
    assert.equal(dialog.style.top, "", "no top shift while the keyboard is closed");
    assert.equal(dialog.style.maxHeight, "", "no maxHeight cap while the keyboard is closed");

    // Keyboard opens (covers 320px): dialog shifts up by half the inset and
    // caps its height so all fields stay reachable above the keyboard.
    await setKeyboardCoverage(320);
    assert.equal(
      dialog.style.top,
      "calc(50% - 160px)",
      "dialog must shift up by half the keyboard inset while typing",
    );
    assert.equal(
      dialog.style.maxHeight,
      serializedMaxHeight("calc(100dvh - 320px - 2rem)"),
      "dialog height must be capped to the space above the keyboard",
    );
    assert.equal(dialog.style.overflowY, "auto", "capped dialog must scroll internally");

    // Keyboard height changes (e.g. suggestion bar toggles): shift follows.
    await setKeyboardCoverage(260);
    assert.equal(
      dialog.style.top,
      "calc(50% - 130px)",
      "shift must track keyboard height changes",
    );
    assert.equal(
      dialog.style.maxHeight,
      serializedMaxHeight("calc(100dvh - 260px - 2rem)"),
      "height cap must track keyboard height changes",
    );

    // Keyboard closes: inline shift removed so the dialog re-centers.
    await setKeyboardCoverage(0);
    assert.equal(dialog.style.top, "", "top shift must be removed once the keyboard closes");
    assert.equal(dialog.style.maxHeight, "", "maxHeight cap must be removed once the keyboard closes");
  } finally {
    cleanup();
  }
});

test("sub-threshold viewport shrink (browser chrome jitter) does not shift the dialog", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { cleanup } = await mountPage();
  try {
    const dialog = await openAppIssueDialog();

    // 60px < 80px threshold: treated as chrome jitter, no shift.
    await setKeyboardCoverage(60);
    assert.equal(dialog.style.top, "", "sub-threshold viewport changes must not shift the dialog");
    assert.equal(dialog.style.maxHeight, "", "sub-threshold viewport changes must not cap the dialog height");
    await setKeyboardCoverage(0);
  } finally {
    cleanup();
  }
});
