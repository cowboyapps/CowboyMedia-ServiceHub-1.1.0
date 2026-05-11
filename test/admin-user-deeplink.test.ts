import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseAdminPortalQuery,
  shouldCleanInitialUrl,
  computeInitialActiveSection,
  computeInitialUserAction,
} from "../client/src/pages/admin-portal-deeplink";
import { runSearch, type SearchStorage } from "../server/search";
import type {
  User,
  Service,
  ServiceAlert,
  NewsStory,
  Ticket,
  KbArticle,
} from "../shared/schema";

function mkUser(over: Partial<User> = {}): User {
  return {
    id: "u-1",
    username: "alice",
    password: "x",
    email: "alice@example.com",
    fullName: "Alice Example",
    role: "customer",
    adminRoleId: null,
    subscribedServices: [],
    theme: "light",
    emailNotifications: true,
    notificationPrefs: {},
    createdAt: new Date(),
    setupReminderDismissed: false,
    setupReminderEmailSent: false,
    chatUsername: null,
    chatNotifications: "mentions",
    chatBanned: false,
    onboardingTourCompletedAt: null,
    totpSecret: null,
    totpEnabledAt: null,
    ...over,
  } as User;
}

function emptyStorage(users: User[]): SearchStorage {
  return {
    getUser: async (id) => users.find((u) => u.id === id),
    getAllServices: async () => [] as Service[],
    getAllAlerts: async () => [] as ServiceAlert[],
    getAllNews: async () => [] as NewsStory[],
    getAllUsers: async () => users,
    getAllTickets: async () => [] as Ticket[],
    getTicketsByCustomer: async () => [] as Ticket[],
    searchKbArticles: async () => [] as KbArticle[],
  };
}

test("parseAdminPortalQuery extracts every supported deep-link param", () => {
  const q = parseAdminPortalQuery("?tab=users&user=u-42&chat=c-1&monitor=m-1&ticket=t-1&section=s-1");
  assert.deepEqual(q, {
    tab: "users",
    chat: "c-1",
    monitor: "m-1",
    ticket: "t-1",
    section: "s-1",
    user: "u-42",
  });
});

test("parseAdminPortalQuery returns all-null for empty/missing search", () => {
  const empty = { tab: null, chat: null, monitor: null, ticket: null, section: null, user: null };
  assert.deepEqual(parseAdminPortalQuery(""), empty);
  assert.deepEqual(parseAdminPortalQuery(null), empty);
  assert.deepEqual(parseAdminPortalQuery(undefined), empty);
});

test("shouldCleanInitialUrl is true when any deep-link param is present", () => {
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?tab=users&user=u-1")), true);
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?user=u-1")), true);
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?chat=c-1")), true);
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?section=s-1")), true);
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?monitor=m-1")), true);
});

test("shouldCleanInitialUrl is false on plain /admin and ticket-only redirects", () => {
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("")), false);
  // ?ticket=... triggers a navigate() to /tickets/<id>, not a clean — must not be in the cleanup list.
  assert.equal(shouldCleanInitialUrl(parseAdminPortalQuery("?ticket=t-1")), false);
});

test("computeInitialActiveSection: ?tab=users lands on the Users tab", () => {
  assert.equal(
    computeInitialActiveSection({ tabParam: "users", hasDashboardView: true }),
    "users",
  );
  assert.equal(
    computeInitialActiveSection({ tabParam: "users", hasDashboardView: false }),
    "users",
  );
});

test("computeInitialActiveSection: support-tickets is filtered (legacy alias) and returns null", () => {
  // Historical: support-tickets used to be a real tab and is now
  // filtered out of the initial seed so the user lands on the
  // sectionless shell (which then renders an empty section while
  // permissions resolve and the async fallback may promote to Overview).
  assert.equal(
    computeInitialActiveSection({ tabParam: "support-tickets", hasDashboardView: true }),
    null,
  );
  assert.equal(
    computeInitialActiveSection({ tabParam: "support-tickets", hasDashboardView: false }),
    null,
  );
});

test("computeInitialActiveSection: no tab + dashboard.view -> Overview, otherwise null", () => {
  assert.equal(
    computeInitialActiveSection({ tabParam: null, hasDashboardView: true }),
    "overview",
  );
  assert.equal(
    computeInitialActiveSection({ tabParam: null, hasDashboardView: false }),
    null,
  );
});

test("computeInitialUserAction: opens dialog for a known initialUserId", () => {
  const target = mkUser({ id: "u-42", fullName: "Target" });
  const others = [mkUser({ id: "u-1" }), target, mkUser({ id: "u-99" })];
  const action = computeInitialUserAction({
    initialUserId: "u-42",
    users: others,
    didFocus: false,
  });
  assert.equal(action.kind, "open");
  if (action.kind === "open") {
    assert.equal(action.target.id, "u-42");
    assert.equal(action.target.fullName, "Target");
  }
});

test("computeInitialUserAction: unknown initialUserId is a safe noop (negative case)", () => {
  const action = computeInitialUserAction({
    initialUserId: "u-does-not-exist",
    users: [mkUser({ id: "u-1" })],
    didFocus: false,
  });
  assert.equal(action.kind, "noop");
});

test("computeInitialUserAction: waits while users list is still loading", () => {
  const action = computeInitialUserAction({
    initialUserId: "u-42",
    users: null,
    didFocus: false,
  });
  assert.equal(action.kind, "wait");
});

test("computeInitialUserAction: no initialUserId is a noop regardless of users", () => {
  assert.equal(
    computeInitialUserAction({ initialUserId: null, users: [mkUser()], didFocus: false }).kind,
    "noop",
  );
  assert.equal(
    computeInitialUserAction({ initialUserId: "", users: [mkUser()], didFocus: false }).kind,
    "noop",
  );
});

test("computeInitialUserAction: is single-shot (didFocus=true short-circuits)", () => {
  const target = mkUser({ id: "u-42" });
  // Even with a matching id and loaded users, once we've already focused
  // we must not reopen the dialog on subsequent re-renders.
  const action = computeInitialUserAction({
    initialUserId: "u-42",
    users: [target],
    didFocus: true,
  });
  assert.equal(action.kind, "noop");
});

test("runSearch projects admin user hits to the deep-link URL the consumer expects", async () => {
  // This is the producer side of the contract: the Cmd+K palette
  // consumes whatever url runSearch emits for the user group, and the
  // admin portal expects /admin?tab=users&user=<id> so its
  // parseAdminPortalQuery + computeInitialUserAction can open the
  // right user.
  const target = mkUser({
    id: "u-42",
    username: "alice",
    fullName: "Alice Example",
    email: "alice@example.com",
  });
  const storage = emptyStorage([target, mkUser({ id: "u-99", username: "bob", email: "bob@x.com", fullName: "Bob" })]);

  const results = await runSearch("alice", { id: "admin-1", role: "master_admin" }, storage);
  assert.equal(results.users.length, 1);
  assert.equal(results.users[0].id, "u-42");
  assert.equal(results.users[0].url, "/admin?tab=users&user=u-42");

  // Round-trip the producer URL through the consumer parser to lock
  // the contract end-to-end.
  const url = new URL(`https://example.com${results.users[0].url}`);
  const q = parseAdminPortalQuery(url.search);
  assert.equal(q.tab, "users");
  assert.equal(q.user, "u-42");
  assert.equal(
    computeInitialActiveSection({ tabParam: q.tab, hasDashboardView: true }),
    "users",
  );
  const action = computeInitialUserAction({
    initialUserId: q.user,
    users: [target],
    didFocus: false,
  });
  assert.equal(action.kind, "open");
  if (action.kind === "open") assert.equal(action.target.id, "u-42");
});

test("runSearch hides the user group from non-admin callers", async () => {
  const storage = emptyStorage([mkUser({ id: "u-42", username: "alice", fullName: "Alice", email: "a@x.com" })]);
  const results = await runSearch("alice", { id: "c-1", role: "customer" }, storage);
  assert.equal(results.users.length, 0);
});
