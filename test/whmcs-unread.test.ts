import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ticketHasNewReply,
  countNewReplies,
  newReplyTicketIds,
  latestReplyDate,
  markSeen,
  type SeenMap,
  type UnreadTicketLike,
} from "../shared/whmcs-unread";

const t = (over: Partial<UnreadTicketLike>): UnreadTicketLike => ({
  id: 1,
  statusKey: "answered",
  lastReply: "2026-06-10",
  ...over,
});

test("ticketHasNewReply: answered + never seen counts as new", () => {
  assert.equal(ticketHasNewReply(t({}), {}), true);
});

test("ticketHasNewReply: answered + seen older date is new", () => {
  const seen: SeenMap = { "1": "2026-06-09" };
  assert.equal(ticketHasNewReply(t({ lastReply: "2026-06-10" }), seen), true);
});

test("ticketHasNewReply: answered + seen same/newer date is NOT new", () => {
  assert.equal(ticketHasNewReply(t({ lastReply: "2026-06-10" }), { "1": "2026-06-10" }), false);
  assert.equal(ticketHasNewReply(t({ lastReply: "2026-06-10" }), { "1": "2026-06-11" }), false);
});

test("ticketHasNewReply: non-answered statuses never count (customer replied last / open / closed)", () => {
  for (const statusKey of ["open", "customer_reply", "in_progress", "on_hold", "closed", "other"]) {
    assert.equal(ticketHasNewReply(t({ statusKey }), {}), false, statusKey);
  }
});

test("ticketHasNewReply: answered but no lastReply date is not new", () => {
  assert.equal(ticketHasNewReply(t({ lastReply: null }), {}), false);
});

test("countNewReplies / newReplyTicketIds: counts only unseen answered tickets", () => {
  const tickets = [
    t({ id: 1, statusKey: "answered", lastReply: "2026-06-10" }), // new (unseen)
    t({ id: 2, statusKey: "answered", lastReply: "2026-06-10" }), // seen
    t({ id: 3, statusKey: "open", lastReply: "2026-06-10" }), // not staff-last
    t({ id: 4, statusKey: "answered", lastReply: "2026-06-12" }), // new (newer than seen)
  ];
  const seen: SeenMap = { "2": "2026-06-10", "4": "2026-06-11" };
  assert.equal(countNewReplies(tickets, seen), 2);
  assert.deepEqual(newReplyTicketIds(tickets, seen), [1, 4]);
});

test("latestReplyDate: returns the max date, ignoring nulls", () => {
  assert.equal(
    latestReplyDate([{ date: "2026-06-01" }, { date: null }, { date: "2026-06-09" }, { date: "2026-06-03" }]),
    "2026-06-09",
  );
  assert.equal(latestReplyDate([]), null);
  assert.equal(latestReplyDate([{ date: null }]), null);
});

test("markSeen: advances the date and never regresses", () => {
  const a = markSeen({}, 7, "2026-06-10");
  assert.deepEqual(a, { "7": "2026-06-10" });

  const b = markSeen(a, 7, "2026-06-12");
  assert.deepEqual(b, { "7": "2026-06-12" });

  // Older date is ignored and the SAME reference is returned (no write needed).
  const c = markSeen(b, 7, "2026-06-11");
  assert.equal(c, b);

  // Null date is a no-op returning the same reference.
  assert.equal(markSeen(b, 7, null), b);
});
