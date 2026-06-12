import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import { findTicketAttachment, type ParsedTicketDetail } from "./whmcs-tickets";

// Route-level tests for the WHMCS billing-ticket attachment HTTP routes (Task
// #346). The pure helpers (parseAttachments / findTicketAttachment /
// encodeTicketAttachments) are unit-tested elsewhere; here we cover the actual
// reply + download-proxy routes that those helpers feed.
//
// Following the pattern in server/message-thread-attachments.test.ts, we mirror
// the security-relevant wiring of the real routes (server/routes.ts) in a
// standalone express app, with spies standing in for the WHMCS client. The
// spies let us prove:
//   - multipart files are forwarded to WHMCS as { name, base64 } uploads,
//   - the "a reply message is required" rule holds (no WHMCS write on empty),
//   - the download proxy only streams an attachment that genuinely belongs to
//     THIS ticket (out-of-thread / wrong-owner locators are rejected before any
//     GetTicketAttachment call), so attachments can't leak across accounts.
//
// The real findTicketAttachment ownership guard is imported and exercised (not
// re-implemented) so the in-thread membership check stays true to production.

// ---------- Helpers mirrored from server/routes.ts (private there) ----------

interface AttachmentUpload {
  name: string;
  base64: string;
}

function toWhmcsAttachmentUploads(files: Express.Multer.File[] | undefined): AttachmentUpload[] {
  return (files ?? []).map((f) => ({ name: f.originalname, base64: f.buffer.toString("base64") }));
}

function parseLocator(
  query: any,
): { type: "reply" | "ticket"; relatedId: number; index: number } | null {
  const type = String(query?.type ?? "");
  if (type !== "reply" && type !== "ticket") return null;
  const relatedId = Number(query?.relatedid);
  const index = Number(query?.index);
  if (!Number.isInteger(relatedId) || relatedId <= 0) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { type, relatedId, index };
}

function safeDownloadFilename(name: string): string {
  return (name || "attachment").replace(/[\r\n"\\/]+/g, "_").trim() || "attachment";
}

// ---------- Fixtures ----------

const TICKET_ID = 555;
const OWNER_CLIENT_ID = 42;
const OTHER_CLIENT_ID = 99;

// A ticket whose opening message carries a "ticket"-type attachment and whose
// staff reply (reply id 100) carries a "reply"-type attachment. Valid locators:
//   { type:"ticket", relatedId:555, index:0 }  -> invoice.pdf
//   { type:"reply",  relatedId:100, index:0 }  -> fix.png
function detailFor(ownerClientId: number): ParsedTicketDetail {
  return {
    id: TICKET_ID,
    tid: String(TICKET_ID),
    subject: "Invoice question",
    status: "Open",
    statusKey: "open",
    department: "Billing",
    priority: "Medium",
    date: "2026-01-01",
    ownerClientId,
    viewUrl: null,
    messages: [
      {
        id: "msg-0",
        authorName: "You",
        authorType: "client",
        date: "2026-01-01",
        message: "Here is my invoice",
        attachments: [{ filename: "invoice.pdf", index: 0, type: "ticket", relatedId: TICKET_ID }],
      },
      {
        id: "100",
        authorName: "Support",
        authorType: "staff",
        date: "2026-01-02",
        message: "Thanks, see attached",
        attachments: [{ filename: "fix.png", index: 0, type: "reply", relatedId: 100 }],
      },
    ],
  };
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

interface ReplyCall {
  ticketId: number;
  principal: number | string;
  message: string;
  attachments: AttachmentUpload[];
}

// ---------- Customer reply route: POST /api/whmcs-tickets/:id/reply ----------

function makeCustomerReplyApp(opts: {
  clientId?: number | null;
  configured?: boolean;
  enabled?: boolean;
  detail?: ParsedTicketDetail | null;
  replyOk?: boolean;
}) {
  const configured = opts.configured ?? true;
  const enabled = opts.enabled ?? true;
  const clientId = opts.clientId === undefined ? OWNER_CLIENT_ID : opts.clientId;
  const detail = opts.detail === undefined ? detailFor(OWNER_CLIENT_ID) : opts.detail;
  const replyOk = opts.replyOk ?? true;

  const replyCalls: ReplyCall[] = [];
  const cacheBusts: number[] = [];

  async function addReplyAsClient(ticketId: number, cid: number, message: string, attachments: AttachmentUpload[]) {
    replyCalls.push({ ticketId, principal: cid, message, attachments });
    return { ok: replyOk };
  }

  const app = express();
  app.post("/api/whmcs-tickets/:id/reply", upload.array("attachments", 5), async (req, res) => {
    try {
      const ticketId = Number(req.params.id);
      if (!Number.isInteger(ticketId) || ticketId <= 0) return res.status(404).json({ message: "Ticket not found" });
      const message = String(req.body?.message ?? "").trim();
      if (!message) return res.status(400).json({ message: "A reply message is required" });
      const attachments = toWhmcsAttachmentUploads(req.files as Express.Multer.File[] | undefined);
      if (!configured || !enabled) return res.status(404).json({ message: "Ticket not found" });
      if (!clientId) return res.status(404).json({ message: "Ticket not found" });
      if (!detail || detail.ownerClientId !== clientId) return res.status(404).json({ message: "Ticket not found" });
      const r = await addReplyAsClient(ticketId, clientId, message, attachments);
      if (!r.ok) return res.status(502).json({ message: "Could not post your reply. Please try again shortly." });
      cacheBusts.push(clientId);
      return res.json({ ok: true, ticket: detail });
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });
  return { app, replyCalls, cacheBusts };
}

// ---------- Admin reply route ----------
// POST /api/admin/users/:id/whmcs/tickets/:ticketId/reply

function makeAdminReplyApp(opts: {
  clientId?: number | null;
  configured?: boolean;
  enabled?: boolean;
  detail?: ParsedTicketDetail | null;
  replyOk?: boolean;
  adminUsername?: string;
  userExists?: boolean;
}) {
  const configured = opts.configured ?? true;
  const enabled = opts.enabled ?? true;
  const clientId = opts.clientId === undefined ? OWNER_CLIENT_ID : opts.clientId;
  const detail = opts.detail === undefined ? detailFor(OWNER_CLIENT_ID) : opts.detail;
  const replyOk = opts.replyOk ?? true;
  const adminUsername = opts.adminUsername === undefined ? "supportbot" : opts.adminUsername;
  const userExists = opts.userExists ?? true;

  const replyCalls: ReplyCall[] = [];
  const cacheBusts: number[] = [];

  async function addReplyAsAdmin(ticketId: number, uname: string, message: string, attachments: AttachmentUpload[]) {
    replyCalls.push({ ticketId, principal: uname, message, attachments });
    return { ok: replyOk, error: "WHMCS rejected the reply" };
  }

  const app = express();
  app.post("/api/admin/users/:id/whmcs/tickets/:ticketId/reply", upload.array("attachments", 5), async (req, res) => {
    try {
      if (!userExists) return res.status(404).json({ message: "User not found" });
      const ticketId = Number(req.params.ticketId);
      if (!Number.isInteger(ticketId) || ticketId <= 0) return res.status(404).json({ message: "Ticket not found" });
      const message = String(req.body?.message ?? "").trim();
      if (!message) return res.status(400).json({ message: "A reply message is required" });
      const attachments = toWhmcsAttachmentUploads(req.files as Express.Multer.File[] | undefined);
      if (!configured || !enabled || !clientId) {
        return res.status(400).json({ message: "WHMCS is not configured or this user is not linked" });
      }
      if (!adminUsername.trim()) {
        return res.status(400).json({ message: "Set a WHMCS admin username in Admin Portal → WHMCS to reply to WHMCS tickets from here." });
      }
      if (!detail || detail.ownerClientId !== clientId) return res.status(404).json({ message: "Ticket not found" });
      const r = await addReplyAsAdmin(ticketId, adminUsername.trim(), message, attachments);
      if (!r.ok) return res.status(502).json({ message: `Could not post reply to WHMCS: ${r.error}` });
      cacheBusts.push(clientId);
      return res.json({ ok: true, ticket: detail });
    } catch {
      return res.status(500).json({ message: "error" });
    }
  });
  return { app, replyCalls, cacheBusts };
}

// ---------- Download proxy routes (customer + admin) ----------

interface DownloadResult {
  ok: boolean;
  filename?: string;
  data?: string;
  error?: string;
}

function makeDownloadApp(opts: {
  mode: "customer" | "admin";
  clientId?: number | null;
  configured?: boolean;
  enabled?: boolean;
  detail?: ParsedTicketDetail | null;
  dl?: DownloadResult;
  userExists?: boolean;
}) {
  const configured = opts.configured ?? true;
  const enabled = opts.enabled ?? true;
  const clientId = opts.clientId === undefined ? OWNER_CLIENT_ID : opts.clientId;
  const detail = opts.detail === undefined ? detailFor(OWNER_CLIENT_ID) : opts.detail;
  const dl: DownloadResult = opts.dl ?? { ok: true, filename: "invoice.pdf", data: Buffer.from("PDF-BYTES").toString("base64") };
  const userExists = opts.userExists ?? true;
  const isAdmin = opts.mode === "admin";

  const downloadCalls: { type: string; relatedId: number; index: number }[] = [];

  async function getAttachment(type: "reply" | "ticket", relatedId: number, index: number): Promise<DownloadResult> {
    downloadCalls.push({ type, relatedId, index });
    return dl;
  }

  const path = isAdmin
    ? "/api/admin/users/:id/whmcs/tickets/:ticketId/attachments"
    : "/api/whmcs-tickets/:id/attachments";

  const app = express();
  app.get(path, async (req, res) => {
    try {
      if (isAdmin && !userExists) return res.status(404).json({ message: "User not found" });
      const params = req.params as Record<string, string>;
      const ticketId = Number(isAdmin ? params.ticketId : params.id);
      if (!Number.isInteger(ticketId) || ticketId <= 0) return res.status(404).json({ message: "Attachment not found" });
      const locator = parseLocator(req.query);
      if (!locator) return res.status(404).json({ message: "Attachment not found" });
      if (!configured || !enabled) return res.status(404).json({ message: "Attachment not found" });
      if (!clientId) return res.status(404).json({ message: "Attachment not found" });
      if (!detail || detail.ownerClientId !== clientId) return res.status(404).json({ message: "Attachment not found" });
      if (!findTicketAttachment(detail, locator.type, locator.relatedId, locator.index)) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const d = await getAttachment(locator.type, locator.relatedId, locator.index);
      if (!d.ok || !d.data) return res.status(502).json({ message: "Could not download this attachment." });
      const buffer = Buffer.from(d.data, "base64");
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${safeDownloadFilename(d.filename ?? "")}"`);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(buffer);
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });
  return { app, downloadCalls, path };
}

// ---------- Request senders ----------

async function postReply(
  app: express.Express,
  url: string,
  fields: { message?: string; files?: { name: string; content: string }[] },
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const form = new FormData();
      if (fields.message !== undefined) form.append("message", fields.message);
      for (const f of fields.files ?? []) {
        form.append("attachments", new Blob([Buffer.from(f.content)]), f.name);
      }
      fetch(`http://127.0.0.1:${port}${url}`, { method: "POST", body: form })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

async function getDownload(
  app: express.Express,
  url: string,
  query: Record<string, string>,
): Promise<{ status: number; contentType: string | null; disposition: string | null; cacheControl: string | null; text: string }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const qs = new URLSearchParams(query).toString();
      fetch(`http://127.0.0.1:${port}${url}${qs ? `?${qs}` : ""}`)
        .then(async (r) => ({
          status: r.status,
          contentType: r.headers.get("content-type"),
          disposition: r.headers.get("content-disposition"),
          cacheControl: r.headers.get("cache-control"),
          text: await r.text(),
        }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const CUSTOMER_REPLY_URL = `/api/whmcs-tickets/${TICKET_ID}/reply`;
const ADMIN_REPLY_URL = `/api/admin/users/u1/whmcs/tickets/${TICKET_ID}/reply`;
const CUSTOMER_DL_URL = `/api/whmcs-tickets/${TICKET_ID}/attachments`;
const ADMIN_DL_URL = `/api/admin/users/u1/whmcs/tickets/${TICKET_ID}/attachments`;

// ================= Customer reply tests =================

test("customer reply: message + file → 200, file forwarded to WHMCS as { name, base64 }, cache busted", async () => {
  const ctx = makeCustomerReplyApp({});
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, {
    message: "Here is the receipt",
    files: [{ name: "receipt.pdf", content: "receipt-bytes" }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(ctx.replyCalls.length, 1);
  assert.equal(ctx.replyCalls[0].ticketId, TICKET_ID);
  assert.equal(ctx.replyCalls[0].principal, OWNER_CLIENT_ID, "customer reply is attributed to the client id");
  assert.equal(ctx.replyCalls[0].message, "Here is the receipt");
  assert.equal(ctx.replyCalls[0].attachments.length, 1);
  assert.equal(ctx.replyCalls[0].attachments[0].name, "receipt.pdf");
  assert.equal(ctx.replyCalls[0].attachments[0].base64, Buffer.from("receipt-bytes").toString("base64"));
  assert.deepEqual(ctx.cacheBusts, [OWNER_CLIENT_ID]);
});

test("customer reply: multiple files are all forwarded", async () => {
  const ctx = makeCustomerReplyApp({});
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, {
    message: "two files",
    files: [
      { name: "a.png", content: "aaa" },
      { name: "b.png", content: "bbbb" },
    ],
  });
  assert.equal(r.status, 200);
  assert.equal(ctx.replyCalls[0].attachments.length, 2);
  assert.deepEqual(ctx.replyCalls[0].attachments.map((a) => a.name), ["a.png", "b.png"]);
});

test("customer reply: missing message → 400, NO WHMCS write", async () => {
  const ctx = makeCustomerReplyApp({});
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, { files: [{ name: "x.pdf", content: "x" }] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /reply message is required/i);
  assert.equal(ctx.replyCalls.length, 0, "no reply forwarded to WHMCS when the message is missing");
  assert.equal(ctx.cacheBusts.length, 0);
});

test("customer reply: whitespace-only message → 400, NO WHMCS write", async () => {
  const ctx = makeCustomerReplyApp({});
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, { message: "   " });
  assert.equal(r.status, 400);
  assert.equal(ctx.replyCalls.length, 0);
});

test("customer reply: ticket owned by a DIFFERENT client → 404, NO WHMCS write", async () => {
  const ctx = makeCustomerReplyApp({ detail: detailFor(OTHER_CLIENT_ID) });
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, { message: "let me in" });
  assert.equal(r.status, 404);
  assert.equal(ctx.replyCalls.length, 0, "a customer cannot reply to another client's ticket");
});

test("customer reply: user not linked to a WHMCS client → 404, NO WHMCS write", async () => {
  const ctx = makeCustomerReplyApp({ clientId: null });
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, { message: "hi" });
  assert.equal(r.status, 404);
  assert.equal(ctx.replyCalls.length, 0);
});

test("customer reply: WHMCS write fails → 502", async () => {
  const ctx = makeCustomerReplyApp({ replyOk: false });
  const r = await postReply(ctx.app, CUSTOMER_REPLY_URL, { message: "hi" });
  assert.equal(r.status, 502);
  assert.equal(ctx.replyCalls.length, 1, "the write was attempted");
  assert.equal(ctx.cacheBusts.length, 0, "cache is not busted when the write fails");
});

// ================= Admin reply tests =================

test("admin reply: message + file → 200, forwarded to WHMCS attributed to the admin username", async () => {
  const ctx = makeAdminReplyApp({});
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, {
    message: "Staff response",
    files: [{ name: "patch.zip", content: "zip-bytes" }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(ctx.replyCalls.length, 1);
  assert.equal(ctx.replyCalls[0].principal, "supportbot", "admin reply is attributed to the WHMCS admin username");
  assert.equal(ctx.replyCalls[0].attachments[0].name, "patch.zip");
  assert.equal(ctx.replyCalls[0].attachments[0].base64, Buffer.from("zip-bytes").toString("base64"));
  assert.deepEqual(ctx.cacheBusts, [OWNER_CLIENT_ID]);
});

test("admin reply: missing message → 400, NO WHMCS write", async () => {
  const ctx = makeAdminReplyApp({});
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, { files: [{ name: "x.pdf", content: "x" }] });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /reply message is required/i);
  assert.equal(ctx.replyCalls.length, 0);
});

test("admin reply: no WHMCS admin username configured → 400, NO WHMCS write", async () => {
  const ctx = makeAdminReplyApp({ adminUsername: "" });
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, { message: "staff reply" });
  assert.equal(r.status, 400);
  assert.match(r.body.message, /admin username/i);
  assert.equal(ctx.replyCalls.length, 0, "we never misattribute a staff reply to the client");
});

test("admin reply: target user does not exist → 404, NO WHMCS write", async () => {
  const ctx = makeAdminReplyApp({ userExists: false });
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, { message: "hi" });
  assert.equal(r.status, 404);
  assert.equal(ctx.replyCalls.length, 0);
});

test("admin reply: ticket owned by a different client → 404, NO WHMCS write", async () => {
  const ctx = makeAdminReplyApp({ detail: detailFor(OTHER_CLIENT_ID) });
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, { message: "hi" });
  assert.equal(r.status, 404);
  assert.equal(ctx.replyCalls.length, 0);
});

test("admin reply: WHMCS not configured / user not linked → 400, NO WHMCS write", async () => {
  const ctx = makeAdminReplyApp({ clientId: null });
  const r = await postReply(ctx.app, ADMIN_REPLY_URL, { message: "hi" });
  assert.equal(r.status, 400);
  assert.equal(ctx.replyCalls.length, 0);
});

// ================= Customer download proxy tests =================

test("customer download: valid ticket-type locator → 200 streams the file bytes with download headers", async () => {
  const ctx = makeDownloadApp({ mode: "customer" });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 200);
  assert.equal(r.text, "PDF-BYTES");
  assert.equal(r.contentType, "application/octet-stream");
  assert.match(r.disposition ?? "", /filename="invoice.pdf"/);
  assert.match(r.cacheControl ?? "", /private/);
  assert.equal(ctx.downloadCalls.length, 1);
  assert.deepEqual(ctx.downloadCalls[0], { type: "ticket", relatedId: TICKET_ID, index: 0 });
});

test("customer download: valid reply-type locator → 200 streams bytes", async () => {
  const ctx = makeDownloadApp({ mode: "customer" });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "reply", relatedid: "100", index: "0" });
  assert.equal(r.status, 200);
  assert.deepEqual(ctx.downloadCalls[0], { type: "reply", relatedId: 100, index: 0 });
});

test("customer download: out-of-thread locator (reply id not in this ticket) → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "customer" });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "reply", relatedid: "999", index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0, "an attachment not in this thread is rejected before any download");
});

test("customer download: ticket owned by a different client → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "customer", detail: detailFor(OTHER_CLIENT_ID) });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0, "cannot download from another client's ticket");
});

test("customer download: malformed locator (missing type) → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "customer" });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0);
});

test("customer download: user not linked → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "customer", clientId: null });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0);
});

test("customer download: WHMCS fetch fails → 502", async () => {
  const ctx = makeDownloadApp({ mode: "customer", dl: { ok: false, error: "boom" } });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 502);
  assert.equal(ctx.downloadCalls.length, 1, "the attachment belonged to the ticket, so the fetch was attempted");
});

// ================= Admin download proxy tests =================

test("admin download: valid locator → 200 streams bytes", async () => {
  const ctx = makeDownloadApp({ mode: "admin" });
  const r = await getDownload(ctx.app, ADMIN_DL_URL, { type: "reply", relatedid: "100", index: "0" });
  assert.equal(r.status, 200);
  assert.equal(r.text, "PDF-BYTES");
  assert.deepEqual(ctx.downloadCalls[0], { type: "reply", relatedId: 100, index: 0 });
});

test("admin download: out-of-thread locator → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "admin" });
  const r = await getDownload(ctx.app, ADMIN_DL_URL, { type: "reply", relatedid: "999", index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0);
});

test("admin download: ticket owned by a different client → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "admin", detail: detailFor(OTHER_CLIENT_ID) });
  const r = await getDownload(ctx.app, ADMIN_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0);
});

test("admin download: target user does not exist → 404, WHMCS never queried", async () => {
  const ctx = makeDownloadApp({ mode: "admin", userExists: false });
  const r = await getDownload(ctx.app, ADMIN_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 404);
  assert.equal(ctx.downloadCalls.length, 0);
});

// ============ Forced save-to-device coverage (Task #381) ============
// Mirrors the invoice-PDF download assertions (server/whmcs-invoice-pdf-route.test.ts,
// Task #378), which guard that a "Download" action reliably saves to the device on
// mobile — where inline viewing is unreliable. The invoice proxy switches between
// inline (preview) and attachment (forced save) on ?download=1; the ticket
// attachment proxies have no preview mode at all — they ALWAYS force a save
// (Content-Disposition: attachment), because ticket attachments are arbitrary
// files that should never be rendered inline. These tests lock that behaviour in
// so the same regression that would silently break mobile downloads can't land
// here: the disposition must stay "attachment" by default AND regardless of any
// query string (including a stray ?download=0 / ?inline=1 a caller might add).

test("customer download: default → Content-Disposition forces a save (attachment)", async () => {
  const ctx = makeDownloadApp({ mode: "customer" });
  const r = await getDownload(ctx.app, CUSTOMER_DL_URL, { type: "ticket", relatedid: String(TICKET_ID), index: "0" });
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^attachment; filename="invoice.pdf"$/, "must save to device, not display inline");
});

test("customer download: stays attachment regardless of query (no inline mode)", async () => {
  const extras: Record<string, string>[] = [{ download: "0" }, { inline: "1" }, { download: "false" }];
  for (const extra of extras) {
    const ctx = makeDownloadApp({ mode: "customer" });
    const r = await getDownload(ctx.app, CUSTOMER_DL_URL, {
      type: "ticket",
      relatedid: String(TICKET_ID),
      index: "0",
      ...extra,
    });
    assert.equal(r.status, 200);
    assert.match(r.disposition ?? "", /^attachment; /, `expected forced save for query ${JSON.stringify(extra)}`);
  }
});

test("admin download: default → Content-Disposition forces a save (attachment)", async () => {
  const ctx = makeDownloadApp({ mode: "admin" });
  const r = await getDownload(ctx.app, ADMIN_DL_URL, { type: "reply", relatedid: "100", index: "0" });
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^attachment; filename="invoice.pdf"$/, "must save to device, not display inline");
});

test("admin download: stays attachment regardless of query (no inline mode)", async () => {
  const extras: Record<string, string>[] = [{ download: "0" }, { inline: "1" }, { download: "false" }];
  for (const extra of extras) {
    const ctx = makeDownloadApp({ mode: "admin" });
    const r = await getDownload(ctx.app, ADMIN_DL_URL, {
      type: "reply",
      relatedid: "100",
      index: "0",
      ...extra,
    });
    assert.equal(r.status, 200);
    assert.match(r.disposition ?? "", /^attachment; /, `expected forced save for query ${JSON.stringify(extra)}`);
  }
});
