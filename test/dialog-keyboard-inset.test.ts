import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the GENERIC keyboard-aware shared dialog
// primitives (client/src/components/ui/dialog.tsx + alert-dialog.tsx).
// Unlike test/report-dialog-keyboard-inset.test.ts (which pins the
// report page's own inline style), this file mounts a bare Dialog and
// AlertDialog with no caller-supplied style and asserts the built-in
// fix: when the iOS keyboard covers part of the layout viewport, the
// content shifts up by half the inset (top: calc(50% - inset/2)), caps
// its height (maxHeight: calc(100dvh - inset - 2rem), overflowY auto),
// and resets when the keyboard closes. It also pins that a
// caller-supplied inline style wins over the generic fix.
// Harness + visualViewport stub mirror test/report-dialog-keyboard-inset.test.ts.
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

Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });

// --- Controllable visualViewport stub ---------------------------------------
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

after(() => {
  try {
    window.close();
  } catch {}
});

// Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const {
  Dialog, DialogContent, DialogTitle, DialogDescription,
} = await import("../client/src/components/ui/dialog");
const {
  AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription,
} = await import("../client/src/components/ui/alert-dialog");

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface Mounted {
  content: HTMLElement;
  cleanup: () => void;
}

async function mount(node: React.ReactElement, role: string): Promise<Mounted> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container);
  await act(async () => {
    root.render(node);
  });
  await flush();
  const content = window.document.body.querySelector<HTMLElement>(`[role="${role}"]`);
  assert.ok(content, `${role} content mounted`);
  return {
    content: content!,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// jsdom's cssstyle serializer normalizes calc(); round-trip expected strings
// through a scratch element so assertions pin the source value, not the
// serializer's quirks.
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

function plainDialog(style?: React.CSSProperties): React.ReactElement {
  return React.createElement(
    Dialog,
    { open: true },
    React.createElement(
      DialogContent,
      { style, "data-testid": "generic-dialog" } as never,
      React.createElement(DialogTitle, null, "Generic dialog"),
      React.createElement(DialogDescription, null, "Body"),
    ),
  );
}

test("bare DialogContent shifts up and caps height while the keyboard is open, and resets on close", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { content, cleanup } = await mount(plainDialog(), "dialog");
  try {
    assert.equal(content.style.top, "", "no top shift while the keyboard is closed");
    assert.equal(content.style.maxHeight, "", "no maxHeight cap while the keyboard is closed");

    await setKeyboardCoverage(320);
    assert.equal(content.style.top, "calc(50% - 160px)", "dialog shifts up by half the keyboard inset");
    assert.equal(
      content.style.maxHeight,
      serializedMaxHeight("calc(100dvh - 320px - 2rem)"),
      "dialog height capped to the space above the keyboard",
    );
    assert.equal(content.style.overflowY, "auto", "capped dialog scrolls internally");

    await setKeyboardCoverage(0);
    assert.equal(content.style.top, "", "shift removed once the keyboard closes");
    assert.equal(content.style.maxHeight, "", "cap removed once the keyboard closes");
  } finally {
    cleanup();
  }
});

test("caller-supplied inline style wins over the generic keyboard fix", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { content, cleanup } = await mount(
    plainDialog({ top: "10%", maxHeight: "200px" }),
    "dialog",
  );
  try {
    await setKeyboardCoverage(320);
    assert.equal(content.style.top, "10%", "caller top overrides the generic shift");
    assert.equal(content.style.maxHeight, "200px", "caller maxHeight overrides the generic cap");
    await setKeyboardCoverage(0);
  } finally {
    cleanup();
  }
});

test("bare AlertDialogContent gets the same keyboard shift and reset", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const node = React.createElement(
    AlertDialog,
    { open: true },
    React.createElement(
      AlertDialogContent,
      null,
      React.createElement(AlertDialogTitle, null, "Confirm"),
      React.createElement(AlertDialogDescription, null, "Body"),
    ),
  );
  const { content, cleanup } = await mount(node, "alertdialog");
  try {
    assert.equal(content.style.top, "", "no shift while the keyboard is closed");

    await setKeyboardCoverage(320);
    assert.equal(content.style.top, "calc(50% - 160px)", "alert dialog shifts up by half the inset");
    assert.equal(
      content.style.maxHeight,
      serializedMaxHeight("calc(100dvh - 320px - 2rem)"),
      "alert dialog height capped above the keyboard",
    );
    assert.equal(content.style.overflowY, "auto", "capped alert dialog scrolls internally");

    await setKeyboardCoverage(0);
    assert.equal(content.style.top, "", "shift removed once the keyboard closes");
  } finally {
    cleanup();
  }
});
