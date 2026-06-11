import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeTicketStatus,
  isClosedStatus,
  buildTicketViewUrl,
  buildTicketsPortalUrl,
  parseTicketSummary,
  deriveReplyAuthorType,
  parseReply,
  buildTicketDetail,
  buildTicketsList,
} from "./whmcs-tickets";
import type { WhmcsRawFetch } from "./whmcs";

const BASE = "https://billing.example.com";

// ---------- normalizeTicketStatus ----------

test("normalizeTicketStatus: maps the default WHMCS statuses (case-insensitive)", () => {
  assert.equal(normalizeTicketStatus("Open"), "open");
  assert.equal(normalizeTicketStatus("Answered"), "answered");
  assert.equal(normalizeTicketStatus("Customer-Reply"), "customer_reply");
  assert.equal(normalizeTicketStatus("customer reply"), "customer_reply");
  assert.equal(normalizeTicketStatus("In Progress"), "in_progress");
  assert.equal(normalizeTicketStatus("On Hold"), "on_hold");
  assert.equal(normalizeTicketStatus("CLOSED"), "closed");
  assert.equal(normalizeTicketStatus("Escalated"), "other");
  assert.equal(normalizeTicketStatus(""), "other");
  assert.equal(normalizeTicketStatus(null), "other");
});

test("isClosedStatus: only closed counts as closed", () => {
  assert.equal(isClosedStatus("closed"), true);
  assert.equal(isClosedStatus("open"), false);
  assert.equal(isClosedStatus("answered"), false);
});

// ---------- URLs ----------

test("buildTicketViewUrl / buildTicketsPortalUrl: build links, null without a base URL", () => {
  assert.equal(buildTicketViewUrl(BASE, 42), "https://billing.example.com/viewticket.php?tid=42");
  assert.equal(buildTicketViewUrl(null, 42), null);
  assert.equal(buildTicketViewUrl(BASE, 0), null);
  assert.equal(buildTicketsPortalUrl(BASE), "https://billing.example.com/supporttickets.php");
  assert.equal(buildTicketsPortalUrl(null), null);
});

// ---------- parseTicketSummary ----------

test("parseTicketSummary: maps fields and normalizes dates/status", () => {
  const t = parseTicketSummary({
    id: 7,
    tid: "832910",
    subject: " Help with my domain ",
    status: "Answered",
    deptname: "Support",
    priority: "High",
    date: "2026-06-01 10:00:00",
    lastreply: "2026-06-02 12:00:00",
  });
  assert.equal(t.id, 7);
  assert.equal(t.tid, "832910");
  assert.equal(t.subject, "Help with my domain");
  assert.equal(t.status, "Answered");
  assert.equal(t.statusKey, "answered");
  assert.equal(t.department, "Support");
  assert.equal(t.priority, "High");
  assert.equal(t.date, "2026-06-01");
  assert.equal(t.lastReply, "2026-06-02");
});

test("parseTicketSummary: falls back tid->id and empty subject placeholder", () => {
  const t = parseTicketSummary({ id: 9, subject: "" });
  assert.equal(t.tid, "9");
  assert.equal(t.subject, "(no subject)");
});

// ---------- author type ----------

test("deriveReplyAuthorType: requestor_type and admin field drive staff/client", () => {
  assert.equal(deriveReplyAuthorType({ requestor_type: "Owner" }), "client");
  assert.equal(deriveReplyAuthorType({ requestor_type: "Member" }), "client");
  assert.equal(deriveReplyAuthorType({ requestor_type: "Operator" }), "staff");
  assert.equal(deriveReplyAuthorType({ requestor_type: "Admin" }), "staff");
  assert.equal(deriveReplyAuthorType({ admin: "Jane" }), "staff");
  assert.equal(deriveReplyAuthorType({ requestor_type: "System" }), "other");
  // No signal at all defaults to client (the opening post).
  assert.equal(deriveReplyAuthorType({}), "client");
});

test("parseReply: names staff and client sensibly", () => {
  const staff = parseReply({ requestor_type: "Operator", admin: "Jane", date: "2026-06-02", message: " Hi " }, 0);
  assert.equal(staff.authorType, "staff");
  assert.equal(staff.authorName, "Jane");
  assert.equal(staff.message, "Hi");
  const client = parseReply({ requestor_type: "Owner", name: "Bob", date: "2026-06-01", message: "Hello" }, 1);
  assert.equal(client.authorType, "client");
  assert.equal(client.authorName, "Bob");
  // Synthesized id when no replyid.
  assert.equal(client.id, "msg-1");
  const withId = parseReply({ replyid: 55, message: "x" }, 2);
  assert.equal(withId.id, "55");
});

// ---------- buildTicketDetail ----------

const okFetch = (data: any): WhmcsRawFetch => ({ ok: true, data });
const failFetch = (): WhmcsRawFetch => ({ ok: false, error: "boom", reason: "network" });

test("buildTicketDetail: null on failed fetch or missing id", () => {
  assert.equal(buildTicketDetail(failFetch(), BASE), null);
  assert.equal(buildTicketDetail(okFetch({ subject: "no id" }), BASE), null);
});

test("buildTicketDetail: folds replies, keeps owner id, builds view url", () => {
  const detail = buildTicketDetail(
    okFetch({
      id: 7,
      tid: "832910",
      subject: "Domain",
      status: "Customer-Reply",
      deptname: "Support",
      userid: 123,
      date: "2026-06-01",
      replies: {
        reply: [
          { replyid: 1, requestor_type: "Owner", name: "Bob", date: "2026-06-01", message: "First" },
          { replyid: 2, requestor_type: "Operator", admin: "Jane", date: "2026-06-02", message: "Reply" },
        ],
      },
    }),
    BASE,
  );
  assert.ok(detail);
  assert.equal(detail!.id, 7);
  assert.equal(detail!.ownerClientId, 123);
  assert.equal(detail!.statusKey, "customer_reply");
  assert.equal(detail!.messages.length, 2);
  assert.equal(detail!.messages[0].authorType, "client");
  assert.equal(detail!.messages[1].authorType, "staff");
  assert.equal(detail!.viewUrl, "https://billing.example.com/viewticket.php?tid=7");
});

test("buildTicketDetail: synthesizes the opening post when replies are empty", () => {
  const detail = buildTicketDetail(
    okFetch({ id: 8, tid: "8", subject: "S", status: "Open", userid: 5, date: "2026-06-01", name: "Bob", message: "Opening message" }),
    BASE,
  );
  assert.ok(detail);
  assert.equal(detail!.messages.length, 1);
  assert.equal(detail!.messages[0].message, "Opening message");
  assert.equal(detail!.messages[0].authorType, "client");
});

// ---------- buildTicketsList ----------

test("buildTicketsList: unreachable on failure", () => {
  const list = buildTicketsList(failFetch(), BASE);
  assert.equal(list.unreachable, true);
  assert.deepEqual(list.tickets, []);
  assert.equal(list.portalUrl, "https://billing.example.com/supporttickets.php");
});

test("buildTicketsList: sorts most-recent-activity first and drops id-less rows", () => {
  const list = buildTicketsList(
    okFetch({
      tickets: {
        ticket: [
          { id: 1, tid: "1", subject: "Old", status: "Closed", lastreply: "2026-05-01" },
          { id: 2, tid: "2", subject: "New", status: "Open", lastreply: "2026-06-10" },
          { id: 0, tid: "x", subject: "Bad" },
        ],
      },
    }),
    BASE,
  );
  assert.equal(list.unreachable, false);
  assert.equal(list.tickets.length, 2);
  assert.equal(list.tickets[0].id, 2);
  assert.equal(list.tickets[1].id, 1);
});

test("buildTicketsList: single ticket object (not array) normalizes to one row", () => {
  const list = buildTicketsList(
    okFetch({ tickets: { ticket: { id: 3, tid: "3", subject: "Solo", status: "Open" } } }),
    BASE,
  );
  assert.equal(list.tickets.length, 1);
  assert.equal(list.tickets[0].id, 3);
});
