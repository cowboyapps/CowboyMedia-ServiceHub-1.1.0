import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/chat-composer.test.ts) ----------
// This test covers the React wiring around the pure unread logic that
// test/whmcs-unread.test.ts already exercises: the "Billing & account support"
// section header count, the per-row "New reply" badge rendered by
// WhmcsTicketList, and the clear-on-open behaviour (localStorage seen map +
// the reactive useWhmcsSeenMap hook) that the detail page drives via
// markTicketSeen.
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
// markTicketSeen / readSeenMap read the global `localStorage`, and
// writeSeenMap dispatches a CustomEvent on the global `window` that
// useWhmcsSeenMap listens for — both must point at the jsdom window.
g.localStorage = window.localStorage;

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
// esbuild compiles the client component's JSX to React.createElement with the
// classic runtime, so React must be a global before it renders.
g.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { WhmcsTicketList } = await import("../client/src/components/whmcs-tickets");
type WhmcsTicketSummary =
  import("../client/src/components/whmcs-tickets").WhmcsTicketSummary;
type WhmcsTicketsListData =
  import("../client/src/components/whmcs-tickets").WhmcsTicketsListData;
const { useWhmcsSeenMap, markTicketSeen } = await import("../client/src/lib/whmcs-unread");
const { countNewReplies, newReplyTicketIds } = await import("../shared/whmcs-unread");

after(() => {
  try {
    window.close();
  } catch {}
});

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

const ticket = (over: Partial<WhmcsTicketSummary>): WhmcsTicketSummary => ({
  id: 1,
  tid: "1000",
  subject: "Billing question",
  status: "Answered",
  statusKey: "answered",
  department: "Billing",
  priority: "Medium",
  date: "2026-06-01",
  lastReply: "2026-06-10",
  ...over,
});

function listData(tickets: WhmcsTicketSummary[]): WhmcsTicketsListData {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    tickets,
    portalUrl: null,
  };
}

// Mirror the tickets-page wiring (lines that compute whmcsNewReplyCount /
// whmcsNewReplyIds from the reactive seen map and render the section badge +
// WhmcsTicketList) so the test exercises the same integration the customer
// sees, without dragging in the whole authenticated page.
const Harness: React.FC<{ userId: string; tickets: WhmcsTicketSummary[] }> = ({
  userId,
  tickets,
}) => {
  const seen = useWhmcsSeenMap(userId);
  const count = countNewReplies(tickets, seen);
  const ids = new Set(newReplyTicketIds(tickets, seen));
  return React.createElement(
    React.Fragment,
    null,
    count > 0
      ? React.createElement(
          "span",
          { "data-testid": "badge-whmcs-new-replies" },
          `${count} new`,
        )
      : null,
    React.createElement(WhmcsTicketList, {
      data: listData(tickets),
      isLoading: false,
      context: "customer" as const,
      onOpen: () => {},
      newReplyIds: ids,
    }),
  );
};

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountHarness(userId: string, tickets: WhmcsTicketSummary[]): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Harness, { userId, tickets }));
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

test("section badge count + per-row 'New reply' badges reflect unseen answered tickets", async () => {
  const userId = "user-badge-1";
  window.localStorage.clear();
  // Ticket 2 has already been opened up to its latest reply, so it is seen.
  markTicketSeen(userId, 2, "2026-06-10");

  const tickets = [
    ticket({ id: 1, statusKey: "answered", lastReply: "2026-06-10" }), // answered + unseen -> new
    ticket({ id: 2, statusKey: "answered", lastReply: "2026-06-10" }), // answered + seen -> not new
    ticket({ id: 3, statusKey: "open", lastReply: "2026-06-10" }), // customer's court -> not new
  ];

  const h = await mountHarness(userId, tickets);
  try {
    const sectionBadge = findByTestId(h.container, "badge-whmcs-new-replies");
    assert.ok(sectionBadge, "section header shows a new-replies badge");
    assert.equal(sectionBadge!.textContent, "1 new", "only the one unseen answered ticket is counted");

    assert.ok(
      findByTestId(h.container, "badge-whmcs-ticket-new-1"),
      "unseen answered ticket shows its 'New reply' row badge",
    );
    assert.equal(
      findByTestId(h.container, "badge-whmcs-ticket-new-2"),
      null,
      "already-seen answered ticket shows no 'New reply' badge",
    );
    assert.equal(
      findByTestId(h.container, "badge-whmcs-ticket-new-3"),
      null,
      "non-answered ticket shows no 'New reply' badge",
    );
  } finally {
    h.cleanup();
  }
});

test("opening a ticket (markTicketSeen) clears it from the count reactively", async () => {
  const userId = "user-badge-2";
  window.localStorage.clear();

  const tickets = [ticket({ id: 1, statusKey: "answered", lastReply: "2026-06-10" })];

  const h = await mountHarness(userId, tickets);
  try {
    assert.equal(
      findByTestId(h.container, "badge-whmcs-new-replies")?.textContent,
      "1 new",
      "starts with one unseen answered reply",
    );
    assert.ok(
      findByTestId(h.container, "badge-whmcs-ticket-new-1"),
      "row badge present before the thread is opened",
    );

    // Simulate the detail page's markTicketSeen effect firing when the customer
    // opens the thread. useWhmcsSeenMap should pick up the change via the
    // in-tab CustomEvent and drop the ticket from the count.
    await act(async () => {
      markTicketSeen(userId, 1, "2026-06-10");
    });

    assert.equal(
      findByTestId(h.container, "badge-whmcs-new-replies"),
      null,
      "section badge disappears once the only unseen ticket is marked seen",
    );
    assert.equal(
      findByTestId(h.container, "badge-whmcs-ticket-new-1"),
      null,
      "row 'New reply' badge clears after marking the ticket seen",
    );
  } finally {
    h.cleanup();
  }
});
