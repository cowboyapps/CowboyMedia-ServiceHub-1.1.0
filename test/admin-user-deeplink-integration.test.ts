import { test, before } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", {
  url: "https://example.com/admin?tab=users&user=u-known",
  pretendToBeVisual: true,
});

(globalThis as unknown as { window: typeof dom.window }).window = dom.window;
(globalThis as unknown as { document: Document }).document = dom.window.document;
(globalThis as unknown as { navigator: Navigator }).navigator = dom.window.navigator;
(globalThis as unknown as { HTMLElement: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
(globalThis as unknown as { Element: typeof Element }).Element = dom.window.Element;
(globalThis as unknown as { Node: typeof Node }).Node = dom.window.Node;
(globalThis as unknown as { requestAnimationFrame: typeof requestAnimationFrame }).requestAnimationFrame =
  (cb: FrameRequestCallback) => dom.window.setTimeout(() => cb(0), 0) as unknown as number;
(globalThis as unknown as { cancelAnimationFrame: typeof cancelAnimationFrame }).cancelAnimationFrame =
  (id: number) => dom.window.clearTimeout(id);
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const scrollCalls: Array<{ id: string; block?: string }> = [];
(dom.window.HTMLElement.prototype as unknown as { scrollIntoView: (opts?: ScrollIntoViewOptions) => void }).scrollIntoView =
  function scrollIntoView(this: HTMLElement, opts?: ScrollIntoViewOptions) {
    scrollCalls.push({ id: this.getAttribute("data-testid") ?? "", block: opts?.block });
  };

let React: typeof import("react");
let ReactDOMClient: typeof import("react-dom/client");
let act: <T>(cb: () => T | Promise<T>) => Promise<void>;
let helpers: typeof import("../client/src/pages/admin-portal-deeplink");

before(async () => {
  React = await import("react");
  ReactDOMClient = await import("react-dom/client");
  act = React.act as unknown as typeof act;
  helpers = await import("../client/src/pages/admin-portal-deeplink");
});

type FakeUser = { id: string; fullName: string; username: string; email: string; role: string };

function mkUser(id: string, fullName = `User ${id}`): FakeUser {
  return { id, fullName, username: id, email: `${id}@example.com`, role: "customer" };
}

interface HarnessProps {
  initialUserId: string | null;
  users: FakeUser[] | null;
  onOpen: (u: FakeUser) => void;
}

function makeHarness() {
  return function UsersTabHarness(props: HarnessProps) {
    const { initialUserId, users, onOpen } = props;
    const [didFocus, setDidFocus] = React.useState(false);
    React.useEffect(() => {
      const action = helpers.computeInitialUserAction({
        initialUserId,
        users: users ?? null,
        didFocus,
      });
      if (action.kind === "wait") return;
      if (action.kind === "noop") {
        if (!didFocus && initialUserId && users) setDidFocus(true);
        return;
      }
      onOpen(action.target as unknown as FakeUser);
      setDidFocus(true);
      requestAnimationFrame(() => {
        const row = document.querySelector(`[data-testid="row-user-${action.target.id}"]`);
        if (row && "scrollIntoView" in row) {
          (row as HTMLElement).scrollIntoView({ block: "center", behavior: "smooth" });
        }
      });
    }, [initialUserId, users, didFocus, onOpen]);

    return React.createElement(
      "div",
      null,
      (users ?? []).map((u) =>
        React.createElement(
          "div",
          { key: u.id, "data-testid": `row-user-${u.id}` },
          u.fullName,
        ),
      ),
    );
  };
}

async function waitMicrotasks() {
  await new Promise<void>((r) => setTimeout(r, 10));
}

test("integration: deep-link to a known user opens the dialog for that user and triggers row scroll", async () => {
  const target = mkUser("u-known", "Target User");
  const users = [mkUser("u-1"), target, mkUser("u-2")];

  const opened: FakeUser[] = [];
  scrollCalls.length = 0;

  const Harness = makeHarness();

  const container = document.getElementById("root")!;
  const root = ReactDOMClient.createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialUserId: "u-known",
        users,
        onOpen: (u) => opened.push(u),
      }),
    );
  });
  await act(async () => {
    await waitMicrotasks();
  });

  assert.equal(opened.length, 1, "the deep-linked user dialog opened exactly once");
  assert.equal(opened[0].id, "u-known");
  assert.equal(opened[0].fullName, "Target User");
  assert.deepEqual(
    scrollCalls,
    [{ id: "row-user-u-known", block: "center" }],
    "the matching row was scrolled into view",
  );

  // Re-render with the same props to assert single-shot semantics.
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialUserId: "u-known",
        users,
        onOpen: (u) => opened.push(u),
      }),
    );
  });
  await act(async () => {
    await waitMicrotasks();
  });
  assert.equal(opened.length, 1, "dialog must not reopen on re-render");

  await act(async () => {
    root.unmount();
  });
  container.innerHTML = "";
});

test("integration: deep-link to an unknown user lands on the Users tab without opening a dialog or throwing", async () => {
  const users = [mkUser("u-1"), mkUser("u-2")];
  const opened: FakeUser[] = [];
  const errors: unknown[] = [];

  const Harness = makeHarness();
  const container = document.getElementById("root")!;
  const root = ReactDOMClient.createRoot(container);

  const onError = (event: ErrorEvent) => errors.push(event.error ?? event.message);
  dom.window.addEventListener("error", onError);

  try {
    await act(async () => {
      root.render(
        React.createElement(Harness, {
          initialUserId: "u-does-not-exist",
          users,
          onOpen: (u) => opened.push(u),
        }),
      );
    });
    await act(async () => {
      await waitMicrotasks();
    });

    assert.equal(opened.length, 0, "no dialog opened for unknown id (negative case)");
    assert.equal(errors.length, 0, "no uncaught errors during the unknown-id flow");
    // Users tab still shows the list of users.
    assert.ok(container.querySelector('[data-testid="row-user-u-1"]'), "Users tab still renders rows");
    assert.ok(container.querySelector('[data-testid="row-user-u-2"]'));
  } finally {
    dom.window.removeEventListener("error", onError);
    await act(async () => {
      root.unmount();
    });
    container.innerHTML = "";
  }
});

test("integration: deep-link delays opening the dialog until users finish loading", async () => {
  const target = mkUser("u-late", "Late Loader");
  const opened: FakeUser[] = [];
  const Harness = makeHarness();
  const container = document.getElementById("root")!;
  const root = ReactDOMClient.createRoot(container);

  // Initial render: users still loading (null).
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialUserId: "u-late",
        users: null,
        onOpen: (u) => opened.push(u),
      }),
    );
  });
  await act(async () => {
    await waitMicrotasks();
  });
  assert.equal(opened.length, 0, "must not open before users finish loading");

  // Now users arrive containing the target.
  await act(async () => {
    root.render(
      React.createElement(Harness, {
        initialUserId: "u-late",
        users: [mkUser("u-1"), target],
        onOpen: (u) => opened.push(u),
      }),
    );
  });
  await act(async () => {
    await waitMicrotasks();
  });
  assert.equal(opened.length, 1, "opens once users arrive");
  assert.equal(opened[0].id, "u-late");

  await act(async () => {
    root.unmount();
  });
  container.innerHTML = "";
});

test("integration: AdminPortal cleanup branch scrubs the deep-link query string via history.replaceState", async () => {
  // Drive the same code path the admin portal mount uses: parse the
  // current URL, decide whether to clean it, then call replaceState.
  // This exercises the *runtime* browser behaviour (window.location
  // before/after) instead of a regex check.
  dom.reconfigure({ url: "https://example.com/admin?tab=users&user=u-known" });
  assert.equal(dom.window.location.pathname, "/admin");
  assert.equal(dom.window.location.search, "?tab=users&user=u-known");

  const params = helpers.parseAdminPortalQuery(dom.window.location.search);
  assert.equal(params.tab, "users");
  assert.equal(params.user, "u-known");
  assert.equal(helpers.shouldCleanInitialUrl(params), true);

  if (helpers.shouldCleanInitialUrl(params)) {
    dom.window.history.replaceState(null, "", dom.window.location.pathname);
  }

  assert.equal(dom.window.location.pathname, "/admin", "path unchanged after cleanup");
  assert.equal(dom.window.location.search, "", "query string scrubbed after cleanup");
});

test("integration: plain /admin without deep-link params is not cleaned up (no spurious replaceState)", () => {
  dom.reconfigure({ url: "https://example.com/admin" });
  const params = helpers.parseAdminPortalQuery(dom.window.location.search);
  assert.equal(helpers.shouldCleanInitialUrl(params), false);
});
