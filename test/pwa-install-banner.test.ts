import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the custom PWA install banner. It must: show an Install
// button when the browser has fired `beforeinstallprompt`; fire the native
// prompt and hide on accept; persist a dismissal cool-off; show iOS-Safari
// "Add to Home Screen" guidance (no Install button) instead of the prompt;
// stay hidden when already installed (standalone), when the cool-off is active,
// and while the customer SetupReminder modal is open.
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
g.localStorage = window.localStorage;
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLButtonElement", "HTMLDivElement", "HTMLAnchorElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
] as const;
for (const key of BROWSER_GLOBALS) {
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

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

// Controllable userAgent so a single jsdom instance can pose as Android Chrome
// or iOS Safari per test. jsdom's navigator.userAgent is read-only, so shadow
// it with a configurable getter.
let currentUA =
  "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
Object.defineProperty(window.navigator, "userAgent", {
  configurable: true,
  get: () => currentUA,
});

// Controllable matchMedia: `standalone` drives display-mode, `mobile` drives
// the width query used by useIsMobile.
let standalone = false;
let mobile = true;
const matchMediaImpl = (query: string) => ({
  matches:
    query.includes("display-mode: standalone")
      ? standalone
      : query.includes("max-width")
        ? mobile
        : false,
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
window.matchMedia = matchMediaImpl as unknown as typeof window.matchMedia;

g.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;

const { PwaInstallBanner, PWA_BANNER_SHOW_DELAY_MS } = await import(
  "../client/src/components/pwa-install-banner"
);
const { INSTALL_DISMISS_KEY } = await import("../client/src/hooks/use-pwa-install");
const { setSetupReminderOpen } = await import("../client/src/lib/setup-reminder-state");

after(() => {
  try { window.close(); } catch {}
});

beforeEach(() => {
  currentUA =
    "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";
  standalone = false;
  mobile = true;
  setSetupReminderOpen(false);
  try { window.localStorage.clear(); } catch {}
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

// Wait past the banner's slide-in delay so the "should show" assertions are real.
async function waitForDelay(): Promise<void> {
  await act(async () => {
    await new Promise<void>((r) => setTimeout(r, PWA_BANNER_SHOW_DELAY_MS + 50));
  });
  await flush();
}

interface FakeInstallEvent {
  preventDefault(): void;
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  promptCalled: boolean;
}

function makeInstallEvent(outcome: "accepted" | "dismissed"): FakeInstallEvent {
  const ev = new window.Event("beforeinstallprompt") as unknown as FakeInstallEvent & Event;
  ev.promptCalled = false;
  ev.prompt = async () => { ev.promptCalled = true; };
  ev.userChoice = Promise.resolve({ outcome, platform: "web" });
  return ev as unknown as FakeInstallEvent;
}

interface MountResult {
  root: Root;
  cleanup: () => void;
}

async function mount(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(PwaInstallBanner));
  });
  await flush();
  return {
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

async function fireBeforeInstallPrompt(ev: FakeInstallEvent): Promise<void> {
  await act(async () => {
    window.dispatchEvent(ev as unknown as Event);
  });
  await flush();
}

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

function get(id: string): HTMLElement {
  const el = window.document.body.querySelector(`[data-testid="${id}"]`);
  assert.ok(el, `expected element [data-testid="${id}"] to exist`);
  return el as HTMLElement;
}

async function click(id: string): Promise<void> {
  const el = get(id);
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

test("shows Install button after beforeinstallprompt (Android/desktop)", async () => {
  const h = await mount();
  try {
    assert.equal(has("banner-pwa-install"), false, "hidden before the event fires");
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.ok(has("banner-pwa-install"), "banner shows once installable");
    assert.ok(has("button-pwa-install"), "Install button present");
    assert.equal(has("text-pwa-install-ios-guide"), false, "no iOS guidance on Android");
  } finally {
    h.cleanup();
  }
});

test("clicking Install fires the native prompt and hides the banner", async () => {
  const h = await mount();
  try {
    const ev = makeInstallEvent("accepted");
    await fireBeforeInstallPrompt(ev);
    await waitForDelay();
    assert.ok(has("button-pwa-install"));
    await click("button-pwa-install");
    assert.equal(ev.promptCalled, true, "native prompt was invoked");
    assert.equal(has("banner-pwa-install"), false, "banner hides after accepted install");
  } finally {
    h.cleanup();
  }
});

test("dismiss persists a cool-off and keeps the banner hidden on remount", async () => {
  const h = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.ok(has("banner-pwa-install"));
    await click("button-pwa-install-dismiss");
    assert.equal(has("banner-pwa-install"), false, "banner hides on dismiss");
    const stored = window.localStorage.getItem(INSTALL_DISMISS_KEY);
    assert.ok(stored && Number(stored) > Date.now(), "cool-off timestamp persisted in the future");
  } finally {
    h.cleanup();
  }

  // Fresh mount with the cool-off still active — must stay hidden.
  const h2 = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.equal(has("banner-pwa-install"), false, "cool-off suppresses the banner next visit");
  } finally {
    h2.cleanup();
  }
});

test("declining the native prompt records the cool-off and hides the banner", async () => {
  const h = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("dismissed"));
    await waitForDelay();
    assert.ok(has("button-pwa-install"));
    await click("button-pwa-install");
    assert.equal(has("banner-pwa-install"), false, "banner hides after the user declines");
    const stored = window.localStorage.getItem(INSTALL_DISMISS_KEY);
    assert.ok(stored && Number(stored) > Date.now(), "cool-off persisted on decline");
  } finally {
    h.cleanup();
  }
});

test("appinstalled event hides the banner immediately", async () => {
  const h = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.ok(has("banner-pwa-install"), "banner visible while installable");
    await act(async () => {
      window.dispatchEvent(new window.Event("appinstalled"));
    });
    await flush();
    assert.equal(has("banner-pwa-install"), false, "banner hides once the app is installed");
  } finally {
    h.cleanup();
  }
});

test("iOS Safari shows Add-to-Home-Screen guidance and no Install button", async () => {
  currentUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
  const h = await mount();
  try {
    // No beforeinstallprompt on iOS — banner still appears via the Safari path.
    await waitForDelay();
    assert.ok(has("banner-pwa-install"), "iOS banner shows in Safari");
    assert.ok(has("text-pwa-install-ios-guide"), "shows Share → Add to Home Screen guidance");
    assert.equal(has("button-pwa-install"), false, "no native Install button on iOS");
  } finally {
    h.cleanup();
  }
});

test("iOS Chrome (CriOS) does not get the Safari guidance", async () => {
  currentUA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120 Mobile/15E148 Safari/604.1";
  const h = await mount();
  try {
    await waitForDelay();
    assert.equal(has("banner-pwa-install"), false, "no banner for non-Safari iOS browsers");
  } finally {
    h.cleanup();
  }
});

test("already-installed (standalone) users never see the banner", async () => {
  standalone = true;
  const h = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.equal(has("banner-pwa-install"), false, "no banner when running standalone");
  } finally {
    h.cleanup();
  }
});

test("banner is suppressed while the SetupReminder modal is open", async () => {
  const h = await mount();
  try {
    await fireBeforeInstallPrompt(makeInstallEvent("accepted"));
    await waitForDelay();
    assert.ok(has("banner-pwa-install"), "banner visible before reminder opens");
    await act(async () => { setSetupReminderOpen(true); });
    await flush();
    assert.equal(has("banner-pwa-install"), false, "banner hides while reminder is open");
    await act(async () => { setSetupReminderOpen(false); });
    await flush();
    assert.ok(has("banner-pwa-install"), "banner returns after reminder closes");
  } finally {
    h.cleanup();
  }
});
