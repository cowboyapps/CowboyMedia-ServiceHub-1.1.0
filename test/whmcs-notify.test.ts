import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectTicketsToNotify,
  cutoffDateString,
  whmcsTicketPath,
  whmcsTicketUrl,
  type NotifyCandidate,
} from "../shared/whmcs-notify";
import type { SeenMap } from "../shared/whmcs-unread";
import { DEFAULT_EMAIL_TEMPLATES } from "../server/email";

const t = (over: Partial<NotifyCandidate>): NotifyCandidate => ({
  id: 1,
  statusKey: "answered",
  lastReply: "2026-06-10",
  ...over,
});

const CUTOFF = "2026-06-08"; // 3 days before 2026-06-11

test("cutoffDateString: N days before, UTC day granularity", () => {
  assert.equal(cutoffDateString(new Date("2026-06-11T15:00:00Z"), 3), "2026-06-08");
  assert.equal(cutoffDateString(new Date("2026-06-01T00:00:00Z"), 1), "2026-05-31");
  assert.equal(cutoffDateString(new Date("2026-06-11T23:59:59Z"), 0), "2026-06-11");
});

test("notifies an answered ticket never notified, within recency window", () => {
  const out = selectTicketsToNotify([t({ id: 5, lastReply: "2026-06-10" })], {}, CUTOFF);
  assert.deepEqual(out.map((x) => x.id), [5]);
});

test("does NOT notify when already notified at the same/newer date (dedupe)", () => {
  const seen: SeenMap = { "5": "2026-06-10" };
  assert.equal(selectTicketsToNotify([t({ id: 5, lastReply: "2026-06-10" })], seen, CUTOFF).length, 0);
  assert.equal(selectTicketsToNotify([t({ id: 5, lastReply: "2026-06-10" })], { "5": "2026-06-11" }, CUTOFF).length, 0);
});

test("notifies again when a newer staff reply arrives after last notified", () => {
  const seen: SeenMap = { "5": "2026-06-09" };
  const out = selectTicketsToNotify([t({ id: 5, lastReply: "2026-06-10" })], seen, CUTOFF);
  assert.deepEqual(out.map((x) => x.id), [5]);
});

test("recency guard: an old answered ticket (before cutoff) is NOT notified on first run", () => {
  const out = selectTicketsToNotify([t({ id: 9, lastReply: "2026-06-01" })], {}, CUTOFF);
  assert.equal(out.length, 0);
});

test("non-answered statuses never notify (customer replied last / open / closed)", () => {
  for (const statusKey of ["open", "customer_reply", "in_progress", "on_hold", "closed", "other"]) {
    assert.equal(selectTicketsToNotify([t({ statusKey })], {}, CUTOFF).length, 0, statusKey);
  }
});

test("answered with no lastReply date is skipped", () => {
  assert.equal(selectTicketsToNotify([t({ lastReply: null })], {}, CUTOFF).length, 0);
});

test("whmcsTicketPath / whmcsTicketUrl build the correct deep link", () => {
  assert.equal(whmcsTicketPath(42), "/whmcs-tickets/42");
  assert.equal(whmcsTicketUrl("https://cowboyhub.app", 42), "https://cowboyhub.app/whmcs-tickets/42");
  // Trailing slashes on the base are trimmed (no double slash).
  assert.equal(whmcsTicketUrl("https://cowboyhub.app/", 42), "https://cowboyhub.app/whmcs-tickets/42");
  assert.equal(whmcsTicketUrl("http://localhost:5000", 7), "http://localhost:5000/whmcs-tickets/7");
});

test("billing ticket reply email template carries a deep link to the ticket", () => {
  const tpl = DEFAULT_EMAIL_TEMPLATES.find((x) => x.templateKey === "customer_whmcs_ticket_reply");
  assert.ok(tpl, "customer_whmcs_ticket_reply template must exist");
  // Template exposes ticket_url and uses it inside an anchor href.
  assert.ok(tpl!.availableVariables.includes("ticket_url"), "ticket_url must be an available variable");
  assert.match(tpl!.body, /href="\{ticket_url\}"/, "body must link to {ticket_url}");

  // Rendering the body with a concrete URL yields a clickable deep link.
  const url = whmcsTicketUrl("https://cowboyhub.app", 832910);
  const rendered = tpl!.body.replace(/\{(\w+)\}/g, (_m, k) =>
    ({ ticket_subject: "Invoice question", ticket_url: url } as Record<string, string>)[k] ?? "",
  );
  assert.ok(
    rendered.includes(`href="${url}"`),
    "rendered email must include an anchor to the WHMCS ticket deep link",
  );
});

test("mixed inbox: only fresh, unnotified, answered tickets are selected", () => {
  const tickets = [
    t({ id: 1, statusKey: "answered", lastReply: "2026-06-10" }), // new
    t({ id: 2, statusKey: "answered", lastReply: "2026-06-10" }), // already notified
    t({ id: 3, statusKey: "open", lastReply: "2026-06-10" }), // not staff-last
    t({ id: 4, statusKey: "answered", lastReply: "2026-06-01" }), // too old
    t({ id: 5, statusKey: "answered", lastReply: "2026-06-11" }), // new, newer than notified
  ];
  const seen: SeenMap = { "2": "2026-06-10", "5": "2026-06-10" };
  const out = selectTicketsToNotify(tickets, seen, CUTOFF);
  assert.deepEqual(out.map((x) => x.id).sort((a, b) => a - b), [1, 5]);
});
