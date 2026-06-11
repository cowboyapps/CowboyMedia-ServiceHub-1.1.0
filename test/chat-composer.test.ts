import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/template-message-editor.test.ts)
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
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ChatComposer } = await import("../client/src/components/ticket/chat-composer");
type ChatComposerHandle =
  import("../client/src/components/ticket/chat-composer").ChatComposerHandle;
type ComposerSendPayload =
  import("../client/src/components/ticket/chat-composer").ComposerSendPayload;

// Tear the JSDOM window + its raf/timer queue down once all tests finish so
// node:test's runner can exit cleanly. Without this the rAF setTimeout(0)
// stub keeps the loop alive past the last assertion.
after(() => {
  try {
    window.close();
  } catch {}
});

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  handleRef: { current: ChatComposerHandle | null };
  sendCalls: ComposerSendPayload[];
  textarea: () => HTMLTextAreaElement;
  cleanup: () => void;
}

async function mountComposer(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const handleRef: { current: ChatComposerHandle | null } = { current: null };
  const sendCalls: ComposerSendPayload[] = [];

  const queryClient = new QueryClient({
    // gcTime: 0 so React Query's default 5-min cache timer doesn't keep the
    // node:test subprocess alive after the last assertion — without this the
    // file passes but never exits, stalling a full single-pass run.
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const Wrapper: React.FC = () => {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ChatComposer, {
        ref: handleRef,
        ticketId: "ticket-1",
        canReply: true,
        ticketClosed: false,
        disabledReason: null,
        adminUnclaimed: false,
        ticketClaimedByOther: false,
        isAdmin: false, // customer mode keeps the tree minimal
        userId: "user-1",
        userFullName: "Test User",
        placeholderContext: {
          customer_name: null,
          ticket_subject: null,
          admin_name: null,
        },
        suggestions: [],
        aiStatus: { enabled: false },
        internalNotesCount: 0,
        onRequestSend: (payload: ComposerSendPayload) => {
          sendCalls.push(payload);
        },
        onTyping: () => {},
        onOpenInternalNotes: () => {},
        onClaimTicket: () => {},
        claimPending: false,
      }),
    );
  };

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });

  return {
    container,
    root,
    handleRef,
    sendCalls,
    textarea: () => {
      const ta = findByTestId(container, "input-message");
      if (!(ta instanceof window.HTMLTextAreaElement)) {
        throw new Error("textarea not found");
      }
      return ta as HTMLTextAreaElement;
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function typeIntoTextarea(ta: HTMLTextAreaElement, value: string): Promise<void> {
  // React tracks the native input value via a hidden setter — set it via the
  // prototype descriptor so React's onChange fires.
  const proto = Object.getPrototypeOf(ta) as HTMLTextAreaElement;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(ta, value);
  await act(async () => {
    ta.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

// Build a File whose reported `size` we control without allocating real bytes.
function fakeFile(name: string, size: number): File {
  const f = new window.File(["x"], name, { type: "application/octet-stream" });
  Object.defineProperty(f, "size", { value: size, configurable: true });
  return f;
}

// The composer's hidden <input type="file"> is the first file input in the
// tree (the attach-paperclip button clicks it). Stamp a FileList-like onto
// `.files` then fire change the way a real picker would.
async function pickFile(container: HTMLElement, file: File): Promise<void> {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement | null;
  if (!input) throw new Error("file input not found");
  const list = {
    0: file,
    length: 1,
    item: (i: number) => (i === 0 ? file : null),
  } as unknown as FileList;
  Object.defineProperty(input, "files", { value: list, configurable: true });
  await act(async () => {
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
  });
}

const MB = 1024 * 1024;

// --- The placeholder-confirm "Send anyway" flow runs `composerRef.current.clear()`
// before doSendMessage in ticket-detail.tsx's performSend. If that imperative
// handle ever stops clearing the textarea, customers would see their just-sent
// text linger in the composer and may double-send.

test("ChatComposer.clear() empties the textarea (placeholder-confirm 'Send anyway' path)", async () => {
  const h = await mountComposer();
  try {
    const ta = h.textarea();

    await typeIntoTextarea(ta, "hello world");
    assert.equal(ta.value, "hello world", "textarea reflects typed text");

    // Simulate the parent calling composerRef.current.clear() exactly the way
    // performSend / confirmPlaceholderSend do after the user clicks
    // "Send anyway" on the unfilled-placeholder dialog.
    await act(async () => {
      h.handleRef.current?.clear();
    });
    await flushFrames();

    assert.equal(ta.value, "", "textarea is cleared after handle.clear()");
  } finally {
    h.cleanup();
  }
});

test("ChatComposer fires onRequestSend with the typed payload, then clear() resets for the next message", async () => {
  const h = await mountComposer();
  try {
    const ta = h.textarea();
    await typeIntoTextarea(ta, "first message");

    const sendBtn = findByTestId(h.container, "button-send-message");
    assert.ok(sendBtn instanceof window.HTMLButtonElement, "send button present");
    await act(async () => {
      (sendBtn as HTMLButtonElement).click();
    });

    assert.equal(h.sendCalls.length, 1, "onRequestSend fired once");
    assert.deepEqual(h.sendCalls[0], {
      text: "first message",
      file: null,
      kb: null,
      internal: false,
    });

    // The composer doesn't clear itself — the parent decides when to call
    // clear() (either eagerly in performSend, or after the user confirms the
    // unfilled-placeholder dialog). The textarea must still hold the text
    // until then so retry/undo flows have something to work with.
    assert.equal(
      ta.value,
      "first message",
      "composer leaves text in place until parent calls clear()",
    );

    // Parent calls clear() — textarea drops to empty and is ready for the
    // next send.
    await act(async () => {
      h.handleRef.current?.clear();
    });
    await flushFrames();
    assert.equal(ta.value, "");

    // Type again and send again to prove the imperative handle didn't put
    // the composer into a broken state.
    await typeIntoTextarea(ta, "second message");
    await act(async () => {
      (sendBtn as HTMLButtonElement).click();
    });
    assert.equal(h.sendCalls.length, 2, "second send still works after clear()");
    assert.equal(h.sendCalls[1].text, "second message");
  } finally {
    h.cleanup();
  }
});

test("composer shows the attachment's size next to its chip", async () => {
  const h = await mountComposer();
  try {
    await pickFile(h.container, fakeFile("invoice.pdf", Math.round(2.5 * MB)));

    const sizeEl = findByTestId(h.container, "text-attachment-size");
    assert.ok(sizeEl, "size label rendered next to the chip");
    assert.match(sizeEl!.textContent ?? "", /2\.5 MB/, "shows human-readable size");
  } finally {
    h.cleanup();
  }
});

test("oversized attachment is flagged, warned, and blocks send before the request goes out", async () => {
  const h = await mountComposer();
  try {
    const ta = h.textarea();
    // A valid draft so the only thing that could block send is the file size.
    await typeIntoTextarea(ta, "Here is the file you asked for.");

    const sendBefore = findByTestId(h.container, "button-send-message") as HTMLButtonElement;
    assert.equal(sendBefore.disabled, false, "send enabled with a draft and no files");

    // 26MB > the 25MB server cap.
    await pickFile(h.container, fakeFile("huge.zip", 26 * MB));

    const warning = findByTestId(h.container, "text-attachment-oversize-warning");
    assert.ok(warning, "oversize warning is shown before send");

    const sendAfter = findByTestId(h.container, "button-send-message") as HTMLButtonElement;
    assert.equal(sendAfter.disabled, true, "send is blocked while the file is too big");

    // Clicking send while blocked must not fire onRequestSend.
    await act(async () => {
      sendAfter.click();
    });
    assert.equal(h.sendCalls.length, 0, "no request goes out for an oversized file");
  } finally {
    h.cleanup();
  }
});

test("a file at exactly the cap is allowed and does not warn", async () => {
  const h = await mountComposer();
  try {
    const ta = h.textarea();
    await typeIntoTextarea(ta, "Reply with an at-the-limit file.");

    await pickFile(h.container, fakeFile("exact.pdf", 25 * MB));
    assert.equal(
      findByTestId(h.container, "text-attachment-oversize-warning"),
      null,
      "a file exactly at the cap is not flagged",
    );
    const send = findByTestId(h.container, "button-send-message") as HTMLButtonElement;
    assert.equal(send.disabled, false, "at-the-cap file does not block send");
  } finally {
    h.cleanup();
  }
});
