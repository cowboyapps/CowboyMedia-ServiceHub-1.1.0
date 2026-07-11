import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

// Guards the fix from the "app looks frozen on first run" regression: the
// onboarding tour, version-welcome dialog, setup reminder and private-message
// popup all used to be able to pop at once, stacking Radix focus traps until
// the device locked up. The modal queue (client/src/lib/modal-queue.ts) now
// arbitrates so only ONE focus-trapping surface is ever active — the highest
// priority claim wins, the rest render null until it releases.
//
// This test locks down that behaviour end-to-end:
//   1. It reads the REAL slot ids + priorities straight out of the source
//      (App.tsx + the dialog components) so the numbers can't silently drift
//      apart from what the app actually claims.
//   2. It drives the real `useModalSlot` hook with those ids/priorities and
//      proves only the single highest-priority wanting slot is ever active,
//      and that the setup reminder / private-message popup render null while a
//      higher slot is claimed and appear the moment it releases.
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
  "HTMLElement", "HTMLDivElement", "Element", "Node", "Document",
  "DocumentFragment", "Event", "CustomEvent", "MouseEvent", "NodeFilter",
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

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Extract the REAL slot ids + priorities from source --------------------
// Every claim is `useModalSlot("<id>", <priority>, <want>)`. Scanning the
// actual files (rather than hard-coding numbers here) means this test breaks if
// someone reorders the priorities in a way that would let popups stack again.
function extractSlots(relPath: string): Record<string, number> {
  const src = readFileSync(new URL(`../${relPath}`, import.meta.url), "utf8");
  const re = /useModalSlot\(\s*["']([^"']+)["']\s*,\s*(\d+)/g;
  const out: Record<string, number> = {};
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out[m[1]] = Number(m[2]);
  }
  return out;
}

const SLOT_PRIORITIES: Record<string, number> = {
  ...extractSlots("client/src/App.tsx"),
  ...extractSlots("client/src/components/onboarding-tour.tsx"),
  ...extractSlots("client/src/components/version-welcome-dialog.tsx"),
  ...extractSlots("client/src/components/welcome-v7-dialog.tsx"),
  ...extractSlots("client/src/components/changelog-publish-prompt.tsx"),
  ...extractSlots("client/src/components/setup-reminder-dialog.tsx"),
  ...extractSlots("client/src/components/private-message-popup.tsx"),
};

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { useModalSlot, _resetModalQueueForTests } = await import(
  "../client/src/lib/modal-queue"
);

after(() => {
  try { window.close(); } catch {}
});

beforeEach(() => {
  _resetModalQueueForTests();
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

// A faithful stand-in for every real popup: it claims its slot and, exactly
// like SetupReminderDialog (`if (!showReminder || !isMine) return null;`) and
// PrivateMessagePopupInner (`if (!popupMessage || !isMine) return null;`),
// renders its marker only when it both WANTS to show and owns the active slot.
const Slot: React.FC<{ id: string; priority: number; want: boolean }> = ({ id, priority, want }) => {
  const isMine = useModalSlot(id, priority, want);
  if (!want || !isMine) return null;
  return React.createElement("div", { "data-testid": `active-${id}` });
};

const Harness: React.FC<{ wants: Record<string, boolean> }> = ({ wants }) =>
  React.createElement(
    React.Fragment,
    null,
    Object.entries(SLOT_PRIORITIES).map(([id, priority]) =>
      React.createElement(Slot, { key: id, id, priority, want: !!wants[id] }),
    ),
  );

interface Harnessed {
  setWants: (wants: Record<string, boolean>) => Promise<void>;
  active: () => string[];
  isActive: (id: string) => boolean;
  cleanup: () => void;
}

async function mount(initial: Record<string, boolean>): Promise<Harnessed> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root: Root = createRoot(container);

  const render = async (wants: Record<string, boolean>) => {
    await act(async () => {
      root.render(React.createElement(Harness, { wants }));
    });
    await flush();
  };

  await render(initial);

  return {
    setWants: render,
    active: () =>
      Array.from(container.querySelectorAll("[data-testid^='active-']")).map(
        (el) => (el.getAttribute("data-testid") ?? "").replace(/^active-/, ""),
      ),
    isActive: (id) => container.querySelector(`[data-testid="active-${id}"]`) !== null,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// --- Drift guard: the source priorities must keep the safe ordering ---------
// The whole anti-stacking guarantee rests on: onboarding-tour outranks the
// setup reminder, which outranks the private-message popup, and the popup sits
// at the very bottom (it must never cover anything). If a future edit inverts
// any of these, popups can stack again — so fail loudly here.
test("the real source priorities keep onboarding-tour > setup-reminder > private-message", () => {
  for (const id of ["onboarding-tour", "setup-reminder", "private-message"]) {
    assert.ok(
      Number.isFinite(SLOT_PRIORITIES[id]),
      `expected a useModalSlot("${id}", ...) claim to exist in the app source`,
    );
  }
  assert.ok(
    SLOT_PRIORITIES["onboarding-tour"] > SLOT_PRIORITIES["setup-reminder"],
    "onboarding tour must outrank the setup reminder",
  );
  assert.ok(
    SLOT_PRIORITIES["setup-reminder"] > SLOT_PRIORITIES["private-message"],
    "setup reminder must outrank the private-message popup",
  );
  const lowest = Math.min(...Object.values(SLOT_PRIORITIES));
  assert.equal(
    SLOT_PRIORITIES["private-message"],
    lowest,
    "the private-message popup must be the lowest-priority slot so it never covers another popup",
  );
});

// --- Arbitration: only ever ONE active slot --------------------------------
test("when every popup wants to show, only the single highest-priority slot is active", async () => {
  const allWanting = Object.fromEntries(Object.keys(SLOT_PRIORITIES).map((id) => [id, true]));
  const h = await mount(allWanting);
  try {
    const active = h.active();
    assert.equal(active.length, 1, `exactly one slot may be active, got: [${active.join(", ")}]`);

    const expectedTop = Object.entries(SLOT_PRIORITIES).reduce((best, cur) =>
      cur[1] > best[1] ? cur : best,
    )[0];
    assert.equal(active[0], expectedTop, "the active slot is the highest-priority claim");
  } finally {
    h.cleanup();
  }
});

test("onboarding-tour wins over the setup reminder and private-message popup", async () => {
  const h = await mount({ "onboarding-tour": true, "setup-reminder": true, "private-message": true });
  try {
    assert.deepEqual(h.active(), ["onboarding-tour"], "only the onboarding tour is active");
    assert.equal(h.isActive("setup-reminder"), false, "setup reminder renders null under the tour");
    assert.equal(h.isActive("private-message"), false, "private-message renders null under the tour");
  } finally {
    h.cleanup();
  }
});

// --- The release cascade: lower popups appear only as higher ones let go ----
test("setup reminder and private-message popup render null under a higher slot, then appear as it releases", async () => {
  const h = await mount({ "onboarding-tour": true, "setup-reminder": true, "private-message": true });
  try {
    // Tour holds the slot — both lower popups are suppressed.
    assert.equal(h.isActive("onboarding-tour"), true);
    assert.equal(h.isActive("setup-reminder"), false, "setup reminder waits its turn");
    assert.equal(h.isActive("private-message"), false, "private-message waits its turn");

    // Tour finishes → setup reminder takes over; the popup still waits.
    await h.setWants({ "onboarding-tour": false, "setup-reminder": true, "private-message": true });
    assert.deepEqual(h.active(), ["setup-reminder"], "setup reminder becomes active once the tour releases");
    assert.equal(h.isActive("private-message"), false, "private-message still waits under the reminder");

    // Reminder dismissed → the private-message popup finally shows.
    await h.setWants({ "onboarding-tour": false, "setup-reminder": false, "private-message": true });
    assert.deepEqual(h.active(), ["private-message"], "private-message shows once the reminder releases");
  } finally {
    h.cleanup();
  }
});

test("setup reminder outranks the private-message popup when both want to show", async () => {
  const h = await mount({ "setup-reminder": true, "private-message": true });
  try {
    assert.deepEqual(h.active(), ["setup-reminder"], "reminder wins over the message popup");
    assert.equal(h.isActive("private-message"), false, "message popup stays hidden under the reminder");

    await h.setWants({ "setup-reminder": false, "private-message": true });
    assert.deepEqual(h.active(), ["private-message"], "message popup appears once the reminder releases");
  } finally {
    h.cleanup();
  }
});

test("the private-message popup shows normally when nothing higher is claimed", async () => {
  const h = await mount({ "private-message": true });
  try {
    assert.deepEqual(h.active(), ["private-message"], "a lone message popup is free to show");
  } finally {
    h.cleanup();
  }
});
