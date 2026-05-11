import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseTicketFiltersFromSearch,
  buildTicketFilterSearch,
  applyTicketFilters,
  filtersAreActive,
  DEFAULT_TICKET_FILTERS,
  type FilterableTicket,
} from "./ticket-filters";

test("parseTicketFiltersFromSearch reads category, status, claimedBy, priority", () => {
  const f = parseTicketFiltersFromSearch("?category=cat-1&status=closed&claimedBy=me&priority=high");
  assert.deepEqual(f, { status: "closed", categoryId: "cat-1", claimedBy: "me", priority: "high" });
});

test("parseTicketFiltersFromSearch falls back to defaults", () => {
  const f = parseTicketFiltersFromSearch("");
  assert.deepEqual(f, DEFAULT_TICKET_FILTERS);
  const bad = parseTicketFiltersFromSearch("?status=garbage&priority=urgent");
  assert.equal(bad.status, "open");
  assert.equal(bad.priority, "any");
});

test("parseTicketFiltersFromSearch tolerates leading '?' or none", () => {
  const a = parseTicketFiltersFromSearch("?category=x");
  const b = parseTicketFiltersFromSearch("category=x");
  assert.deepEqual(a, b);
});

test("buildTicketFilterSearch omits defaults", () => {
  assert.equal(buildTicketFilterSearch(DEFAULT_TICKET_FILTERS), "");
  assert.equal(
    buildTicketFilterSearch({ status: "closed", categoryId: "c1", claimedBy: "me", priority: "high" }),
    "?status=closed&category=c1&claimedBy=me&priority=high",
  );
});

test("buildTicketFilterSearch is the inverse of parse for non-default filters", () => {
  const original = { status: "all" as const, categoryId: "cat-x", claimedBy: "unclaimed", priority: "low" as const };
  const round = parseTicketFiltersFromSearch(buildTicketFilterSearch(original));
  assert.deepEqual(round, original);
});

const tickets: FilterableTicket[] = [
  { status: "open", priority: "high", categoryId: "billing", claimedBy: null },
  { status: "open", priority: "low", categoryId: "billing", claimedBy: "admin-1" },
  { status: "open", priority: "medium", categoryId: "tech", claimedBy: "admin-2" },
  { status: "closed", priority: "high", categoryId: "tech", claimedBy: "admin-1" },
];

test("applyTicketFilters filters by status", () => {
  const out = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "closed" }, "admin-1");
  assert.equal(out.length, 1);
});

test("applyTicketFilters filters by category", () => {
  const out = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "all", categoryId: "billing" }, null);
  assert.equal(out.length, 2);
});

test("applyTicketFilters claimedBy=me uses current user id", () => {
  const out = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "all", claimedBy: "me" }, "admin-1");
  assert.equal(out.length, 2);
  const noUser = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "all", claimedBy: "me" }, null);
  assert.equal(noUser.length, 0);
});

test("applyTicketFilters claimedBy=unclaimed only matches null claimedBy", () => {
  const out = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "all", claimedBy: "unclaimed" }, "admin-1");
  assert.equal(out.length, 1);
  assert.equal(out[0].claimedBy, null);
});

test("applyTicketFilters priority filter", () => {
  const out = applyTicketFilters(tickets, { ...DEFAULT_TICKET_FILTERS, status: "all", priority: "high" }, null);
  assert.equal(out.length, 2);
});

test("filtersAreActive returns false for defaults, true otherwise", () => {
  assert.equal(filtersAreActive(DEFAULT_TICKET_FILTERS), false);
  assert.equal(filtersAreActive({ ...DEFAULT_TICKET_FILTERS, categoryId: "x" }), true);
  assert.equal(filtersAreActive({ ...DEFAULT_TICKET_FILTERS, claimedBy: "me" }), true);
});
