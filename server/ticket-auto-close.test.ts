import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import express from "express";
import type { Server } from "node:http";
import * as schema from "@shared/schema";
import { db as mainDb, pool as mainPool } from "./db";
import { closeInactiveTickets, createTicketAutoCloseHandlers, getTicketAutoCloseSettings } from "./ticket-auto-close";
import { createRequireAdmin } from "./require-permission";
import { automatedClosureMessage, ticketAutoCloseSettingsSchema, DEFAULT_TICKET_AUTO_CLOSE_MESSAGE } from "@shared/ticket-auto-close";

const namespace = `ticket_inactivity_test_${randomUUID().replaceAll("-", "")}`;
let pool: Pool;
let db: typeof mainDb;
let server: Server;
let url: string;
const old = () => new Date(Date.now() - 8 * 86400000);

before(async () => {
  // A separate schema prevents tests enabling automatic closure on real development tickets.
  await mainPool.query(`CREATE SCHEMA "${namespace}"`);
  for (const table of ["users", "tickets", "ticket_messages", "app_settings", "admin_activity_logs", "ticket_notifications"]) {
    await mainPool.query(`CREATE TABLE "${namespace}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  }
  pool = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${namespace},public`, max: 5 });
  db = drizzle(pool, { schema });
  await pool.query("CREATE TRIGGER ticket_communication_insert BEFORE INSERT ON ticket_messages FOR EACH ROW EXECUTE FUNCTION public.track_ticket_communication()");
  await pool.query("CREATE TRIGGER ticket_reopened_inactivity BEFORE UPDATE OF status ON tickets FOR EACH ROW EXECUTE FUNCTION public.reset_reopened_ticket_inactivity()");
  await getTicketAutoCloseSettings(db);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: req.headers["x-test-role"] as string } as typeof req.session; next(); });
  const guard = createRequireAdmin({ getUser: async id => id ? ({ id, role: id }) : undefined });
  const handlers = createTicketAutoCloseHandlers(db);
  app.get("/settings", guard, handlers.get);
  app.patch("/settings", guard, handlers.patch);
  server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}/settings`;
});
after(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  if (pool) await pool.end();
  await mainPool.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
  await mainPool.end();
});

async function policy(enabled = true, days = 7, message = DEFAULT_TICKET_AUTO_CLOSE_MESSAGE) {
  await db.update(schema.appSettings).set({ ticketAutoCloseEnabled: enabled, ticketAutoCloseDays: days, ticketAutoCloseMessage: message });
}
async function ticket(lastCommunicationAt = old()) {
  const [row] = await db.insert(schema.tickets).values({ subject: `Auto-close ${randomUUID()}`, description: "Original context", customerId: randomUUID(), lastCommunicationAt }).returning();
  return row;
}
async function state(id: string) {
  const [row] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id));
  return row;
}
async function messages(id: string) {
  return db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, id));
}

test("policy defaults are safe; settings routes enforce admin roles and validate days/messages", async () => {
  assert.deepEqual(await getTicketAutoCloseSettings(db), { enabled: false, days: 7, message: DEFAULT_TICKET_AUTO_CLOSE_MESSAGE });
  for (const [role, status] of [["", 401], ["customer", 403], ["admin", 200], ["master_admin", 200]] as const) {
    const response = await fetch(url, { headers: { "x-test-role": role } });
    assert.equal(response.status, status);
  }
  for (const days of [0, -1, 1.5, 366, "7"]) {
    const response = await fetch(url, { method: "PATCH", headers: { "x-test-role": "admin", "content-type": "application/json" }, body: JSON.stringify({ enabled: true, days, message: "Close" }) });
    assert.equal(response.status, 400);
  }
  assert.equal(ticketAutoCloseSettingsSchema.safeParse({ enabled: true, days: 7, message: " " }).success, false);
  assert.equal(ticketAutoCloseSettingsSchema.safeParse({ enabled: true, days: 7, message: "a".repeat(2001) }).success, false);
  const response = await fetch(url, { method: "PATCH", headers: { "x-test-role": "admin", "content-type": "application/json" }, body: JSON.stringify({ enabled: false, days: 2, message: "Custom closure" }) });
  assert.equal(response.status, 200);
  assert.deepEqual(await getTicketAutoCloseSettings(db), { enabled: false, days: 2, message: "Custom closure" });
  const logs = await db.select().from(schema.adminActivityLogs).where(eq(schema.adminActivityLogs.action, "ticket_auto_close_settings_updated"));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].actorId, "admin");
});

test("disabled policy and fresh communication do not close tickets", async () => {
  const stale = await ticket();
  await policy(false);
  assert.equal(await closeInactiveTickets(undefined, stale.id, db), 0);
  await policy();
  const fresh = await ticket(new Date());
  assert.equal(await closeInactiveTickets(undefined, fresh.id, db), 0);
  assert.equal((await state(fresh.id)).status, "open");
});

test("stale ticket closes once atomically with custom automated message, permanent reason and transcript-visible reply", async () => {
  await policy(true, 7, "Automated Message: Please open a new ticket if needed.");
  const original = await ticket();
  const calls: string[] = [];
  const counts = await Promise.all([1, 2].map(() => closeInactiveTickets(async ({ ticket }) => { calls.push(ticket.id); }, original.id, db)));
  assert.equal(counts.reduce((a, b) => a + b), 1);
  assert.deepEqual(calls, [original.id]);
  const closed = await state(original.id);
  assert.equal(closed.status, "closed");
  assert.equal(closed.closureReason, "inactivity");
  assert.ok(closed.closedAt);
  assert.ok(closed.closedBy);
  assert.equal(closed.lastCommunicationAt.toISOString(), original.lastCommunicationAt.toISOString());
  assert.match(closed.resolutionNote!, /7 days without communication/);
  assert.ok(closed.resolutionNote!.includes(original.lastCommunicationAt.toISOString()));
  const transcript = (await messages(original.id)).filter(m => !m.isInternal);
  assert.equal(transcript.length, 1);
  assert.equal(transcript[0].message, "Automated Message: Please open a new ticket if needed.");
  const logs = await db.select().from(schema.adminActivityLogs).where(eq(schema.adminActivityLogs.targetId, original.id));
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, "ticket_auto_closed");
  assert.equal(JSON.parse(logs[0].details!).reason, "inactivity");
  assert.equal((await db.select().from(schema.ticketNotifications).where(eq(schema.ticketNotifications.ticketId, original.id))).length, 1);
  assert.equal(await closeInactiveTickets(undefined, original.id, db), 0);
});

test("replies and attachment-only sends refresh activity; notes, receipts, edits and deletion do not", async () => {
  await policy();
  for (const attachment of [false, true]) {
    const row = await ticket();
    const [sent] = await db.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: attachment ? "" : "Still need help", imageUrl: attachment ? "/uploads/test.png" : null }).returning();
    assert.ok((await state(row.id)).lastCommunicationAt.getTime() > row.lastCommunicationAt.getTime());
    assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
    await db.update(schema.tickets).set({ lastCommunicationAt: old() }).where(eq(schema.tickets.id, row.id));
    const baseline = (await state(row.id)).lastCommunicationAt;
    await db.update(schema.ticketMessages).set({ readAt: new Date(), message: "Edited", editedAt: new Date() }).where(eq(schema.ticketMessages.id, sent.id));
    await db.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: "Internal note", isInternal: true });
    await db.delete(schema.ticketMessages).where(eq(schema.ticketMessages.id, sent.id));
    assert.equal((await state(row.id)).lastCommunicationAt.toISOString(), baseline.toISOString());
    assert.equal(await closeInactiveTickets(undefined, row.id, db), 1);
  }
});

test("reply winning the row lock prevents closure; closed-ticket reply is rejected instead of silently lost", async () => {
  await policy();
  const row = await ticket();
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sending = db.transaction(async tx => {
    await tx.select().from(schema.tickets).where(eq(schema.tickets.id, row.id)).for("update");
    await tx.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: "Concurrent reply" });
    locked();
    await gate;
  });
  await ready;
  try { assert.equal(await closeInactiveTickets(undefined, row.id, db), 0); }
  finally { release(); await sending; }
  assert.equal((await state(row.id)).status, "open");
  const closed = await ticket();
  await closeInactiveTickets(undefined, closed.id, db);
  await assert.rejects(db.insert(schema.ticketMessages).values({ ticketId: closed.id, senderId: randomUUID(), message: "Too late" }), /closed|insert/i);
  assert.equal((await messages(closed.id)).length, 1);
});

test("audit failure rolls back closure and its message; reopening starts a fresh inactivity period", async () => {
  await policy();
  const row = await ticket();
  await db.execute(sql.raw(`CREATE FUNCTION "${namespace}".reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END; $$`));
  await db.execute(sql.raw(`CREATE TRIGGER fail_audit BEFORE INSERT ON admin_activity_logs FOR EACH ROW EXECUTE FUNCTION "${namespace}".reject_audit()`));
  try { await assert.rejects(closeInactiveTickets(undefined, row.id, db)); }
  finally { await db.execute(sql.raw("DROP TRIGGER fail_audit ON admin_activity_logs")); }
  assert.equal((await state(row.id)).status, "open");
  assert.equal((await messages(row.id)).length, 0);
  assert.equal((await db.select().from(schema.ticketNotifications).where(eq(schema.ticketNotifications.ticketId, row.id))).length, 0);
  await closeInactiveTickets(undefined, row.id, db);
  await db.update(schema.tickets).set({ status: "open" }).where(eq(schema.tickets.id, row.id));
  assert.ok((await state(row.id)).lastCommunicationAt.getTime() > row.lastCommunicationAt.getTime());
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
});

test("automated label is always present once and body remains plain text", () => {
  assert.equal(automatedClosureMessage("Automated Message: Custom"), "Automated Message: Custom");
  assert.equal(automatedClosureMessage("<script>text</script>"), "Automated Message: <script>text</script>");
});
