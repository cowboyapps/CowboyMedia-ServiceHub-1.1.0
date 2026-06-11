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
  parseAttachments,
  findTicketAttachment,
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

// ---------- parseAttachments ----------

test("parseAttachments: returns [] when there is no owner or no positive id", () => {
  assert.deepEqual(parseAttachments({ attachments: { attachment: ["a.png"] } }, null), []);
  assert.deepEqual(parseAttachments({ attachments: { attachment: ["a.png"] } }, { type: "reply", relatedId: 0 }), []);
});

test("parseAttachments: structured array of name strings keys to owner + 0-based index", () => {
  const out = parseAttachments(
    { attachments: { attachment: ["one.png", "two.pdf"] } },
    { type: "reply", relatedId: 42 },
  );
  assert.deepEqual(out, [
    { filename: "one.png", index: 0, type: "reply", relatedId: 42 },
    { filename: "two.pdf", index: 1, type: "reply", relatedId: 42 },
  ]);
});

test("parseAttachments: tolerates {filename}/{name} objects and explicit index", () => {
  const out = parseAttachments(
    { attachments: [{ filename: "a.png", index: 3 }, { name: "b.txt" }] },
    { type: "ticket", relatedId: 7 },
  );
  assert.deepEqual(out, [
    { filename: "a.png", index: 3, type: "ticket", relatedId: 7 },
    { filename: "b.txt", index: 1, type: "ticket", relatedId: 7 },
  ]);
});

test("parseAttachments: legacy JSON-array string column", () => {
  const out = parseAttachments(
    { attachment: '["legacy, with comma.png","second.jpg"]' },
    { type: "reply", relatedId: 9 },
  );
  assert.deepEqual(out, [
    { filename: "legacy, with comma.png", index: 0, type: "reply", relatedId: 9 },
    { filename: "second.jpg", index: 1, type: "reply", relatedId: 9 },
  ]);
});

test("parseAttachments: legacy bare (non-JSON) string is one file name, never split on commas", () => {
  const out = parseAttachments({ attachment: "my, report.pdf" }, { type: "reply", relatedId: 1 });
  assert.deepEqual(out, [{ filename: "my, report.pdf", index: 0, type: "reply", relatedId: 1 }]);
});

test("parseAttachments: drops blank names, [] when nothing attached", () => {
  assert.deepEqual(parseAttachments({}, { type: "reply", relatedId: 1 }), []);
  assert.deepEqual(
    parseAttachments({ attachments: { attachment: ["", "  "] } }, { type: "reply", relatedId: 1 }),
    [],
  );
});

test("parseReply: folds attachments keyed on the reply id by default", () => {
  const r = parseReply(
    { replyid: 12, requestor_type: "Owner", name: "Bob", message: "see file", attachments: { attachment: ["x.png"] } },
    0,
  );
  assert.deepEqual(r.attachments, [{ filename: "x.png", index: 0, type: "reply", relatedId: 12 }]);
});

test("parseReply: attachmentOwner override keys to a ticket (synthesized opening)", () => {
  const r = parseReply(
    { name: "Bob", message: "opening", attachments: { attachment: ["intro.pdf"] } },
    0,
    { type: "ticket", relatedId: 99 },
  );
  assert.deepEqual(r.attachments, [{ filename: "intro.pdf", index: 0, type: "ticket", relatedId: 99 }]);
});

test("parseReply: no reply id and no owner override yields no attachments", () => {
  const r = parseReply({ name: "Bob", message: "hi", attachments: { attachment: ["x.png"] } }, 0);
  assert.deepEqual(r.attachments, []);
});

test("buildTicketDetail: exposes downloadable attachments on replies and opening post", () => {
  const detail = buildTicketDetail(
    okFetch({
      id: 7,
      tid: "7",
      subject: "Files",
      status: "Open",
      userid: 1,
      date: "2026-06-01",
      name: "Bob",
      message: "Opening",
      attachments: { attachment: ["open.png"] },
      replies: {
        reply: [
          { replyid: 1, requestor_type: "Owner", name: "Bob", message: "Opening", attachments: { attachment: ["open.png"] } },
          { replyid: 2, requestor_type: "Operator", admin: "Jane", message: "Reply", attachments: { attachment: ["resp.pdf"] } },
        ],
      },
    }),
    BASE,
  );
  assert.ok(detail);
  assert.deepEqual(detail!.messages[0].attachments, [{ filename: "open.png", index: 0, type: "reply", relatedId: 1 }]);
  assert.deepEqual(detail!.messages[1].attachments, [{ filename: "resp.pdf", index: 0, type: "reply", relatedId: 2 }]);
});

test("buildTicketDetail: synthesized opening keys attachments to the ticket id", () => {
  const detail = buildTicketDetail(
    okFetch({ id: 8, tid: "8", subject: "S", status: "Open", userid: 5, name: "Bob", message: "Opening", attachments: { attachment: ["spec.pdf"] } }),
    BASE,
  );
  assert.ok(detail);
  assert.equal(detail!.messages.length, 1);
  assert.deepEqual(detail!.messages[0].attachments, [{ filename: "spec.pdf", index: 0, type: "ticket", relatedId: 8 }]);
});

// ---------- findTicketAttachment ----------

const detailWithAttachments = buildTicketDetail(
  okFetch({
    id: 7,
    tid: "7",
    subject: "Files",
    status: "Open",
    userid: 1,
    replies: {
      reply: [
        { replyid: 1, requestor_type: "Owner", name: "Bob", message: "a", attachments: { attachment: ["one.png", "two.pdf"] } },
        { replyid: 2, requestor_type: "Operator", admin: "Jane", message: "b", attachments: { attachment: ["resp.pdf"] } },
      ],
    },
  }),
  BASE,
)!;

test("findTicketAttachment: returns the matching (type, relatedId, index) attachment", () => {
  const a = findTicketAttachment(detailWithAttachments, "reply", 1, 1);
  assert.deepEqual(a, { filename: "two.pdf", index: 1, type: "reply", relatedId: 1 });
});

test("findTicketAttachment: null when index / relatedId / type miss", () => {
  assert.equal(findTicketAttachment(detailWithAttachments, "reply", 1, 5), null);
  assert.equal(findTicketAttachment(detailWithAttachments, "reply", 999, 0), null);
  assert.equal(findTicketAttachment(detailWithAttachments, "ticket", 1, 0), null);
});
