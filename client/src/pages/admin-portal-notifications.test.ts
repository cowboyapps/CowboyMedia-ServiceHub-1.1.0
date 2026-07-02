import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_PAGE_SIZE,
  nextNotificationPageOffset,
  buildNotificationPageQuery,
  resolveNotificationLink,
  type NotificationPage,
} from "./admin-portal-notifications";

// Guards the admin customer-notification-history pagination contract. The API
// caps a single request's `limit` at 100, so the UI must paginate by advancing
// an `offset` with a CONSTANT page size — never by growing `limit` (which clamps
// and would loop on the first page, hiding older history for big customers).

function page(count: number, hasMore: boolean): NotificationPage {
  return { notifications: new Array(count).fill(0), hasMore };
}

test("stops when the last page reports no more rows", () => {
  assert.equal(nextNotificationPageOffset([page(NOTIFICATION_PAGE_SIZE, false)]), undefined);
  assert.equal(nextNotificationPageOffset([]), undefined);
});

test("next offset = total rows loaded so far while more remain", () => {
  assert.equal(nextNotificationPageOffset([page(30, true)]), 30);
  assert.equal(nextNotificationPageOffset([page(30, true), page(30, true)]), 60);
});

test("histories beyond the API's 100-row cap stay reachable", () => {
  // Walk full pages until the server stops saying hasMore, mimicking repeated
  // "Load more" clicks. Offsets must climb past 100 (the per-request cap) —
  // proving we page by offset, not by a clamped, ever-growing limit.
  const pages: NotificationPage[] = [];
  const offsets: number[] = [];
  const TOTAL = 250;
  let guard = 0;
  while (guard++ < 100) {
    const loaded = pages.reduce((n, p) => n + p.notifications.length, 0);
    const next = nextNotificationPageOffset(pages);
    if (pages.length > 0 && next === undefined) break;
    const offset = pages.length === 0 ? 0 : (next as number);
    offsets.push(offset);
    const remaining = TOTAL - offset;
    const take = Math.min(NOTIFICATION_PAGE_SIZE, remaining);
    pages.push(page(take, offset + take < TOTAL));
  }
  const totalLoaded = pages.reduce((n, p) => n + p.notifications.length, 0);
  assert.equal(totalLoaded, TOTAL, "every row must eventually load");
  assert.ok(offsets.some((o) => o >= 100), "offset must advance past the 100 cap");
  // Offsets are exactly the constant-page-size multiples: 0,30,60,...
  assert.deepEqual(offsets.slice(0, 4), [0, 30, 60, 90]);
});

test("query string uses a constant limit + the given offset", () => {
  const qs = buildNotificationPageQuery(90, "all");
  const parsed = new URLSearchParams(qs);
  assert.equal(parsed.get("limit"), String(NOTIFICATION_PAGE_SIZE));
  assert.equal(parsed.get("offset"), "90");
  assert.equal(parsed.get("type"), null); // "all" => no filter
});

test("query string carries a real type filter but omits 'all'/empty", () => {
  assert.equal(new URLSearchParams(buildNotificationPageQuery(0, "whmcs_service_added")).get("type"), "whmcs_service_added");
  assert.equal(new URLSearchParams(buildNotificationPageQuery(0, "")).get("type"), null);
});

// Guards the admin "jump to the thing it was about" affordance. A row links
// through only when it resolves to a safe in-app route; everything else stays
// plain so support never taps a dead or off-app link.

test("prefers the stored internal url exactly as-is", () => {
  assert.equal(resolveNotificationLink({ url: "/tickets/abc" }), "/tickets/abc");
  assert.equal(resolveNotificationLink({ url: "/news/xyz?foo=1" }), "/news/xyz?foo=1");
});

test("trims surrounding whitespace on the stored url", () => {
  assert.equal(resolveNotificationLink({ url: "  /services/s1  " }), "/services/s1");
});

test("rejects external / protocol-relative urls (no off-app links)", () => {
  assert.equal(resolveNotificationLink({ url: "https://evil.example.com" }), null);
  assert.equal(resolveNotificationLink({ url: "//evil.example.com" }), null);
  assert.equal(resolveNotificationLink({ url: "javascript:alert(1)" }), null);
  assert.equal(resolveNotificationLink({ url: "mailto:a@b.com" }), null);
});

test("falls back to a resolvable (referenceType, referenceId) when url is absent", () => {
  assert.equal(resolveNotificationLink({ referenceType: "ticket", referenceId: "T1" }), "/tickets/T1");
  assert.equal(resolveNotificationLink({ referenceType: "news", referenceId: "N1" }), "/news/N1");
  assert.equal(resolveNotificationLink({ referenceType: "service", referenceId: "S1" }), "/services/S1");
});

test("a valid url wins over the reference fallback", () => {
  assert.equal(
    resolveNotificationLink({ url: "/tickets/real", referenceType: "service", referenceId: "S1" }),
    "/tickets/real",
  );
});

test("non-linkable rows resolve to null (plain text, no dead links)", () => {
  assert.equal(resolveNotificationLink({}), null);
  assert.equal(resolveNotificationLink({ url: null, referenceType: null, referenceId: null }), null);
  assert.equal(resolveNotificationLink({ url: "" }), null);
  // Reference type outside the allowlist, or missing an id, stays plain.
  assert.equal(resolveNotificationLink({ referenceType: "service_update_group", referenceId: "S1" }), null);
  assert.equal(resolveNotificationLink({ referenceType: "news_author", referenceId: "A1" }), null);
  assert.equal(resolveNotificationLink({ referenceType: "ticket", referenceId: null }), null);
});
