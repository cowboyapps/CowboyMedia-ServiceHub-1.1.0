import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills used by Radix Popover ---------------------
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

// Mirror every constructor / browser global Radix touches into the Node global.
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

// Force a deterministic rAF that flushFrames() can drain via setTimeout(0).
// Some jsdom builds defer rAF to an internal animation tick that we'd
// otherwise have to keep alive ourselves.
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

// Radix uses these for outside-click / pointer focus tracking; jsdom lacks them.
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

// Imports MUST come after the jsdom globals are installed so React/Radix
// pick up `window`/`document` at module evaluation. Use dynamic imports
// so the static-import hoisting doesn't run them before the shims above.
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const {
  TemplateMessageEditor,
  tokenizeTemplateForEditor,
  hasUnknownPlaceholders,
  applyTemplateReplace,
} = await import("../client/src/components/template-message-editor");
type TemplateEditorPart =
  import("../client/src/components/template-message-editor").TemplateEditorPart;

function findUnknown(parts: TemplateEditorPart[]): Extract<
  TemplateEditorPart,
  { kind: "unknown" }
> {
  const tok = parts.find((p): p is Extract<TemplateEditorPart, { kind: "unknown" }> =>
    p.kind === "unknown",
  );
  assert.ok(tok, "expected an unknown placeholder in parts");
  return tok;
}

// --- pure-helper coverage (cheap) ----------------------------------------

test("tokenize: empty value yields no parts", () => {
  assert.deepEqual(tokenizeTemplateForEditor(""), []);
});

test("tokenize: known variable is folded into surrounding text (no highlight)", () => {
  const parts = tokenizeTemplateForEditor("Hi {{customer_name}}!");
  assert.deepEqual(parts, [
    { kind: "text", value: "Hi " },
    { kind: "text", value: "{{customer_name}}" },
    { kind: "text", value: "!" },
  ]);
  assert.equal(hasUnknownPlaceholders(parts), false);
});

test("tokenize: unknown token records exact char range used by Remove/Edit", () => {
  const value = "Hi {{evil}} world";
  const tok = findUnknown(tokenizeTemplateForEditor(value));
  assert.equal(tok.raw, "{{evil}}");
  assert.equal(value.slice(tok.start, tok.end), tok.raw);
});

test("applyTemplateReplace removes the targeted range and collapses caret to it", () => {
  const result = applyTemplateReplace("Hi {{evil}} world", 3, 11, "", "end");
  assert.equal(result.next, "Hi  world");
  assert.equal(result.selectionStart, 3);
  assert.equal(result.selectionEnd, 3);
});

test("applyTemplateReplace with caret=select highlights the inserted text", () => {
  const result = applyTemplateReplace(
    "Hi {{evil}} world",
    3, 11,
    "{{customer_name}}",
    "select",
  );
  assert.equal(result.next, "Hi {{customer_name}} world");
  assert.equal(result.selectionStart, 3);
  assert.equal(result.selectionEnd, 3 + "{{customer_name}}".length);
});

// --- component-level coverage --------------------------------------------

type Harness = {
  container: HTMLElement;
  root: Root;
  getValue: () => string;
  rerender: (value: string) => Promise<void>;
  cleanup: () => void;
};

async function mountEditor(initialValue: string): Promise<Harness> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let value = initialValue;

  // External handle so the harness can imperatively re-drive the
  // controlled component without re-rendering the wrapper itself.
  const setterRef: { current: ((next: string) => void) | null } = {
    current: null,
  };

  const Wrapper: React.FC = () => {
    const [v, setV] = React.useState(value);
    React.useEffect(() => {
      setterRef.current = setV;
      return () => {
        setterRef.current = null;
      };
    }, []);
    return React.createElement(TemplateMessageEditor, {
      value: v,
      onChange: (next: string) => {
        value = next;
        setV(next);
      },
      testId: "ta-template",
    });
  };

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });

  return {
    container,
    root,
    getValue: () => value,
    rerender: async (next: string) => {
      await act(async () => {
        value = next;
        setterRef.current?.(next);
      });
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function fireClick(el: Element): void {
  el.dispatchEvent(
    new window.MouseEvent("click", { bubbles: true, cancelable: true }),
  );
}

async function flushFrames(): Promise<void> {
  // Flush microtasks + a few rAF/setTimeout(0) ticks so React commits,
  // Radix focus-scope cleanup, and our own requestAnimationFrame focus
  // callback all get a chance to run.
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

function popoverContent(): Element | null {
  // Radix portals into document.body; PopoverContent has data-testid="popover-template-placeholder-<i>".
  return window.document.body.querySelector(
    '[data-testid^="popover-template-placeholder-"]',
  );
}

test("component: clicking an unknown-token highlight opens its popover", async () => {
  const h = await mountEditor("Hi {{evil}} world");
  try {
    const trigger = findByTestId(h.container, "overlay-template-placeholder-token-1");
    assert.ok(trigger, "expected highlight trigger button to render");
    await act(async () => { fireClick(trigger); });
    await flushFrames();
    assert.ok(popoverContent(), "popover content should be in the DOM after click");
  } finally {
    h.cleanup();
  }
});

test('component: "Remove placeholder" deletes only the targeted token and closes the popover', async () => {
  const h = await mountEditor("a {{bad1}} b {{bad2}} c");
  try {
    // Open popover for the SECOND unknown token.
    const triggers = h.container.querySelectorAll(
      '[data-testid^="overlay-template-placeholder-token-"]',
    );
    assert.equal(triggers.length, 2, "expected two highlight triggers");
    const secondTrigger = triggers[1];
    await act(async () => { fireClick(secondTrigger); });
    await flushFrames();

    const removeBtn = window.document.body.querySelector(
      '[data-testid^="button-template-placeholder-remove-"]',
    );
    assert.ok(removeBtn, "Remove button should be visible inside the open popover");

    await act(async () => { fireClick(removeBtn); });
    await flushFrames();

    // onChange fired with only the targeted token's range removed.
    assert.equal(h.getValue(), "a {{bad1}} b  c");

    // Popover is closed (no popover content in the DOM).
    assert.equal(popoverContent(), null, "popover should close after Remove");

    // First unknown is still rendered as a highlight trigger.
    const remaining = h.container.querySelectorAll(
      '[data-testid^="overlay-template-placeholder-token-"]',
    );
    assert.equal(remaining.length, 1);
  } finally {
    h.cleanup();
  }
});

test('component: "Edit manually" focuses the textarea and selects the token range', async () => {
  const value = "prefix {{typo_var}} suffix";
  const h = await mountEditor(value);
  try {
    const trigger = h.container.querySelector(
      '[data-testid^="overlay-template-placeholder-token-"]',
    );
    assert.ok(trigger);
    await act(async () => { fireClick(trigger); });
    await flushFrames();

    const editBtn = window.document.body.querySelector(
      '[data-testid^="button-template-placeholder-edit-"]',
    );
    assert.ok(editBtn, "Edit manually button should be visible");

    // Spy on the textarea's focus + setSelectionRange so we observe the
    // jumpTo() call directly, even if Radix's FocusScope cleanup later
    // races to return focus to the trigger button (RAF vs. setTimeout
    // ordering differs between jsdom and real browsers).
    const ta = findByTestId(h.container, "ta-template");
    assert.ok(ta instanceof window.HTMLTextAreaElement, "textarea should be present");
    const textarea = ta as HTMLTextAreaElement;
    let focusCalls = 0;
    let lastSelection: [number, number] | null = null;
    const origFocus: (opts?: FocusOptions) => void = textarea.focus.bind(textarea);
    const origSetSel: (
      start: number,
      end: number,
      direction?: "forward" | "backward" | "none",
    ) => void = textarea.setSelectionRange.bind(textarea);
    textarea.focus = (opts?: FocusOptions) => {
      focusCalls++;
      origFocus(opts);
    };
    textarea.setSelectionRange = (
      start: number,
      end: number,
      direction?: "forward" | "backward" | "none",
    ) => {
      lastSelection = [start, end];
      origSetSel(start, end, direction);
    };

    await act(async () => { fireClick(editBtn); });
    await flushFrames();

    // Value is unchanged by Edit manually.
    assert.equal(h.getValue(), value);

    const expectedStart = value.indexOf("{{typo_var}}");
    const expectedEnd = expectedStart + "{{typo_var}}".length;

    // jumpTo() focused the textarea and selected exactly the token range.
    assert.ok(focusCalls >= 1, "textarea.focus() should be called by jumpTo");
    assert.deepEqual(lastSelection, [expectedStart, expectedEnd]);
    assert.equal(
      value.slice(expectedStart, expectedEnd),
      "{{typo_var}}",
      "selection range covers the exact token raw text",
    );

    // Popover closed after Edit manually.
    assert.equal(popoverContent(), null);
  } finally {
    h.cleanup();
  }
});

test("component: open popover closes when value updates to remove all unknown highlights", async () => {
  const h = await mountEditor("Hi {{evil}} world");
  try {
    const trigger = h.container.querySelector(
      '[data-testid^="overlay-template-placeholder-token-"]',
    );
    assert.ok(trigger);
    await act(async () => { fireClick(trigger); });
    await flushFrames();
    assert.ok(popoverContent(), "popover should be open before value change");

    // External change to a value with no `{{...}}` highlights.
    await h.rerender("Hi world");
    await flushFrames();

    // The highlight overlay is gone, and so is the popover.
    assert.equal(popoverContent(), null, "popover should close when no unknown tokens remain");
    assert.equal(
      h.container.querySelector('[data-testid="overlay-template-placeholder-highlights"]'),
      null,
      "overlay should disappear when no highlights remain",
    );
  } finally {
    h.cleanup();
  }
});
