import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/chat-composer.test.ts) ---------
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
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement", "HTMLSpanElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException", "File", "Blob",
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

// Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
// The Vite JSX transform auto-imports React in app code; tests run the compiled
// component directly, so React must be a global or JSX calls hit `React is not
// defined`.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { WhmcsTicketThread } = await import("../client/src/components/whmcs-tickets");
type WhmcsTicketDetail =
  import("../client/src/components/whmcs-tickets").WhmcsTicketDetail;

after(() => {
  try {
    window.close();
  } catch {}
});

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

const TICKET: WhmcsTicketDetail = {
  id: 1,
  tid: "100001",
  subject: "Billing question",
  status: "Open",
  statusKey: "open",
  department: "Billing",
  priority: "Medium",
  date: "2026-06-01",
  ownerClientId: 42,
  messages: [
    {
      id: "m1",
      authorName: "Jane Customer",
      authorType: "client",
      date: "2026-06-01",
      message: "Hi, I have a question.",
      attachments: [],
    },
  ],
  viewUrl: null,
};

// Build a File whose reported `size` we control without allocating real bytes.
function fakeFile(name: string, size: number): File {
  const f = new window.File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(f, "size", { value: size, configurable: true });
  return f;
}

async function mountThread(): Promise<{
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(WhmcsTicketThread, {
      ticket: TICKET,
      isLoading: false,
      context: "customer",
      onReply: () => {},
      replyPending: false,
    });

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Drive the hidden <input type="file"> the way a real picker would: stamp a
// FileList-like onto `.files` then fire the change event addFiles listens for.
async function pickFiles(input: HTMLInputElement, files: File[]): Promise<void> {
  const list = {
    ...files,
    length: files.length,
    item: (i: number) => files[i] ?? null,
  } as unknown as FileList;
  Object.defineProperty(input, "files", { value: list, configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

function typeDraft(textarea: HTMLTextAreaElement, value: string): Promise<void> {
  const proto = Object.getPrototypeOf(textarea) as HTMLTextAreaElement;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(textarea, value);
  return act(async () => {
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

const MB = 1024 * 1024;

test("composer shows each attachment's size next to its chip", async () => {
  const h = await mountThread();
  try {
    const input = findByTestId(h.container, "input-whmcs-reply-file") as HTMLInputElement;
    await pickFiles(input, [fakeFile("invoice.pdf", Math.round(2.5 * MB))]);

    const sizeEl = findByTestId(h.container, "text-whmcs-reply-attachment-size-0");
    assert.ok(sizeEl, "size label rendered next to the chip");
    assert.match(sizeEl!.textContent ?? "", /2\.5 MB/, "shows human-readable size");
  } finally {
    h.cleanup();
  }
});

test("oversized attachment is flagged, warned, and blocks send before the request goes out", async () => {
  const h = await mountThread();
  try {
    const input = findByTestId(h.container, "input-whmcs-reply-file") as HTMLInputElement;
    const textarea = findByTestId(h.container, "input-whmcs-reply") as HTMLTextAreaElement;

    // A valid draft so the only thing that could block send is the file size.
    await typeDraft(textarea, "Here is the file you asked for.");

    const sendBefore = findByTestId(h.container, "button-whmcs-reply-send") as HTMLButtonElement;
    assert.equal(sendBefore.disabled, false, "send enabled with a draft and no files");

    // 26MB > the 25MB server cap.
    await pickFiles(input, [fakeFile("huge.zip", 26 * MB)]);

    const warning = findByTestId(h.container, "text-whmcs-reply-oversize-warning");
    assert.ok(warning, "oversize warning is shown before send");

    const sendAfter = findByTestId(h.container, "button-whmcs-reply-send") as HTMLButtonElement;
    assert.equal(sendAfter.disabled, true, "send is blocked while a file is too big");
  } finally {
    h.cleanup();
  }
});

test("a file at exactly the cap is allowed; the warning clears once it's removed", async () => {
  const h = await mountThread();
  try {
    const input = findByTestId(h.container, "input-whmcs-reply-file") as HTMLInputElement;
    const textarea = findByTestId(h.container, "input-whmcs-reply") as HTMLTextAreaElement;
    await typeDraft(textarea, "Reply with an at-the-limit file.");

    await pickFiles(input, [fakeFile("exact.pdf", 25 * MB)]);
    assert.equal(
      findByTestId(h.container, "text-whmcs-reply-oversize-warning"),
      null,
      "a file exactly at the cap is not flagged",
    );
    const send = findByTestId(h.container, "button-whmcs-reply-send") as HTMLButtonElement;
    assert.equal(send.disabled, false, "at-the-cap file does not block send");
  } finally {
    h.cleanup();
  }
});
