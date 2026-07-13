import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isQuickActionMode,
  quickActionNeedle,
  filterQuickActions,
  QUICK_ACTIONS,
  buildVisibleGroups,
  paletteKeyAction,
  type SearchResults,
} from "../client/src/components/command-palette";

function makeResults(over: Partial<SearchResults> = {}): SearchResults {
  return {
    tickets: [],
    articles: [],
    news: [],
    services: [],
    alerts: [],
    users: [],
    ...over,
  };
}

test("isQuickActionMode true for empty or '>' prefix", () => {
  assert.equal(isQuickActionMode(""), true);
  assert.equal(isQuickActionMode("   "), true);
  assert.equal(isQuickActionMode(">"), true);
  assert.equal(isQuickActionMode("> new"), true);
  assert.equal(isQuickActionMode("hello"), false);
});

test("quickActionNeedle strips '>' and lowercases the rest", () => {
  assert.equal(quickActionNeedle(""), "");
  assert.equal(quickActionNeedle(">"), "");
  assert.equal(quickActionNeedle(">  NEW  "), "new");
  assert.equal(quickActionNeedle("hello"), "");
});

test("filterQuickActions hides admin-only actions from non-admins", () => {
  const customer = filterQuickActions(QUICK_ACTIONS, false, "");
  assert.equal(customer.some((a) => a.adminOnly), false);
  assert.equal(customer.some((a) => a.id === "qa-new-ticket"), true);
});

test("filterQuickActions includes admin-only actions for admins", () => {
  const admin = filterQuickActions(QUICK_ACTIONS, true, "");
  assert.equal(admin.some((a) => a.id === "qa-open-tickets"), true);
  assert.equal(admin.some((a) => a.id === "qa-claimed-tickets"), true);
});

// The Admin Portal is a separate PWA now — the customer palette must not
// advertise it, even to admins.
test("no quick action points into the admin app", () => {
  assert.equal(QUICK_ACTIONS.some((a) => a.url.startsWith("/admin")), false);
});

test("filterQuickActions narrows by '>'-prefixed needle", () => {
  const admin = filterQuickActions(QUICK_ACTIONS, true, "> unclaimed");
  assert.equal(admin.length, 1);
  assert.equal(admin[0].id, "qa-unclaimed-tickets");
});

test("buildVisibleGroups skips empty groups and hides users from non-admins", () => {
  const results = makeResults({
    tickets: [{ id: "t1", title: "T1", snippet: "", url: "/tickets/t1" }],
    articles: [],
    news: [{ id: "n1", title: "N1", snippet: "", url: "/news/n1" }],
    users: [{ id: "u1", title: "Alice", snippet: "", url: "/admin" }],
  });
  const customer = buildVisibleGroups(results, false);
  assert.deepEqual(customer.map((g) => g.key), ["tickets", "news"]);
  const admin = buildVisibleGroups(results, true);
  assert.deepEqual(admin.map((g) => g.key), ["tickets", "news", "users"]);
});

test("buildVisibleGroups preserves canonical group order", () => {
  const results = makeResults({
    services: [{ id: "s1", title: "S1", snippet: "", url: "/services/s1" }],
    tickets: [{ id: "t1", title: "T1", snippet: "", url: "/tickets/t1" }],
    alerts: [{ id: "a1", title: "A1", snippet: "", url: "/alerts/a1" }],
    articles: [{ id: "k1", title: "K1", snippet: "", url: "/knowledge/k1" }],
    news: [{ id: "n1", title: "N1", snippet: "", url: "/news/n1" }],
  });
  assert.deepEqual(
    buildVisibleGroups(results, false).map((g) => g.key),
    ["tickets", "articles", "news", "services", "alerts"],
  );
});

test("paletteKeyAction toggles on Cmd/Ctrl+K and closes on Esc", () => {
  assert.equal(paletteKeyAction({ key: "k", metaKey: true }, false), "toggle");
  assert.equal(paletteKeyAction({ key: "K", ctrlKey: true }, true), "toggle");
  assert.equal(paletteKeyAction({ key: "k" }, false), null);
  assert.equal(paletteKeyAction({ key: "Escape" }, true), "close");
  assert.equal(paletteKeyAction({ key: "Escape" }, false), null);
  assert.equal(paletteKeyAction({ key: "Enter", metaKey: true }, true), null);
});
