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
import { closeInactiveTickets, createTicketAutoCloseHandlers, getTicketAutoCloseSettings, remindInactiveTickets } from "./ticket-auto-close";
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
  for (const table of ["users", "tickets", "ticket_messages", "app_settings", "admin_activity_logs", "ticket_notifications", "user_notifications"]) {
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
  assert.deepEqual(await getTicketAutoCloseSettings(db), { enabled: false, days: 7, message: DEFAULT_TICKET_AUTO_CLOSE_MESSAGE, reminderEnabled: false, reminderHoursBefore: 12 });
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
  assert.deepEqual(await getTicketAutoCloseSettings(db), { enabled: false, days: 2, message: "Custom closure", reminderEnabled: false, reminderHoursBefore: 12 });
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

async function reminderPolicy(enabled = true, hours = 12) {
  await policy(true, 7);
  await db.update(schema.appSettings).set({
    ticketAutoCloseReminderEnabled: enabled, ticketAutoCloseReminderHoursBefore: hours,
  });
}
async function reminderTicket(hoursUntilClose = 6, prefs: schema.User["notificationPrefs"] = {}) {
  const [customer] = await db.insert(schema.users).values({
    username: `reminder-${randomUUID()}`, password: "test-only", fullName: "Reminder customer",
    email: "reminder@example.invalid", notificationPrefs: prefs,
  }).returning();
  const row = await ticket(new Date(Date.now() - (7 * 24 - hoursUntilClose) * 3600000));
  await db.update(schema.tickets).set({ customerId: customer.id }).where(eq(schema.tickets.id, row.id));
  return { ...row, customerId: customer.id };
}

test("reminder settings require explicit consent and strictly validate the lead time within the inactivity period", async () => {
  for (const hours of [0, -1, 1.5, 24, 25, "12"]) {
    const response = await fetch(url, { method: "PATCH", headers: { "x-test-role": "admin", "content-type": "application/json" },
      body: JSON.stringify({ enabled: true, days: 1, message: "Close", reminderEnabled: true, reminderHoursBefore: hours }) });
    assert.equal(response.status, 400);
  }
  const response = await fetch(url, { method: "PATCH", headers: { "x-test-role": "admin", "content-type": "application/json" },
    body: JSON.stringify({ enabled: false, days: 1, message: "Close", reminderEnabled: true, reminderHoursBefore: 1 }) });
  assert.equal(response.status, 200);
  assert.equal((await getTicketAutoCloseSettings(db)).reminderEnabled, true);
  // A legacy request cannot accidentally opt customers into reminders.
  const legacy = ticketAutoCloseSettingsSchema.parse({ enabled: true, days: 1, message: "Close" });
  assert.equal(legacy.reminderEnabled, false);
});

test("reminders are disabled by default, respect both switches, window and ticket status", async () => {
  const row = await reminderTicket();
  let sent = 0;
  const send = async () => { sent++; };
  await reminderPolicy(false);
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  await reminderPolicy();
  await policy(false);
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  await policy();
  for (const hours of [13, 0, -1]) {
    const outside = await reminderTicket(hours);
    assert.equal(await remindInactiveTickets(send, outside.id, db), 0);
  }
  await db.update(schema.tickets).set({ status: "closed" }).where(eq(schema.tickets.id, row.id));
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  assert.equal(sent, 0);
});

test("concurrent and repeated sweeps claim each channel once without restarting the closure clock", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  const channels: string[] = [];
  const send = async (reminder: Parameters<Parameters<typeof remindInactiveTickets>[0]>[0]) => {
    channels.push(reminder.channel);
    assert.equal(reminder.closesAt.getTime(), row.lastCommunicationAt.getTime() + 7 * 86400000);
    assert.match(reminder.body, /Reply before then/);
    assert.equal(reminder.url, `/tickets/${row.id}`);
  };
  await Promise.all([remindInactiveTickets(send, row.id, db), remindInactiveTickets(send, row.id, db)]);
  assert.deepEqual(channels.sort(), ["email", "push"]);
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  const bell = await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.referenceId, row.id));
  assert.equal(bell.length, 1);
  assert.equal((await messages(row.id)).length, 0);
  assert.equal((await state(row.id)).lastCommunicationAt.getTime(), row.lastCommunicationAt.getTime());
});

test("customer channel preferences are independent and push/email do not create an unwanted bell", async () => {
  await reminderPolicy();
  for (const selected of ["in_app", "push", "email", "none"] as const) {
    const row = await reminderTicket(6, { ticket_reply: { in_app: selected === "in_app", push: selected === "push", email: selected === "email" } });
    const channels: string[] = [];
    await remindInactiveTickets(async reminder => { channels.push(reminder.channel); }, row.id, db);
    assert.deepEqual(channels, selected === "push" || selected === "email" ? [selected] : []);
    const bell = await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.referenceId, row.id));
    assert.equal(bell.length, selected === "in_app" ? 1 : 0);
  }
});

test("quiet hours defer external channels without duplicating the passive in-app reminder", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  const now = new Date();
  const minute = now.getUTCHours() * 60 + now.getUTCMinutes();
  const hhmm = (n: number) => `${String(Math.floor((n + 1440) % 1440 / 60)).padStart(2, "0")}:${String((n + 1440) % 60).padStart(2, "0")}`;
  await db.update(schema.users).set({ quietHoursEnabled: true, quietHoursStart: hhmm(minute - 60), quietHoursEnd: hhmm(minute + 60), quietHoursTimezone: "UTC" }).where(eq(schema.users.id, row.customerId));
  const channels: string[] = [];
  const send = async (r: Parameters<Parameters<typeof remindInactiveTickets>[0]>[0]) => { channels.push(r.channel); };
  assert.equal(await remindInactiveTickets(send, row.id, db), 1);
  assert.deepEqual(channels, []);
  assert.equal((await state(row.id)).inactivityReminderPushActivity, null);
  await db.update(schema.users).set({ quietHoursEnabled: false }).where(eq(schema.users.id, row.customerId));
  assert.equal(await remindInactiveTickets(send, row.id, db), 2);
  assert.deepEqual(channels.sort(), ["email", "push"]);
  assert.equal((await db.select().from(schema.userNotifications).where(eq(schema.userNotifications.referenceId, row.id))).length, 1);
  const overdue = await reminderTicket(-1);
  assert.equal(await remindInactiveTickets(send, overdue.id, db), 0);
});

test("public replies and attachments reset eligibility, but notes and edits do not", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  let sent = 0;
  const send = async () => { sent++; };
  await remindInactiveTickets(send, row.id, db);
  await db.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: "Private note", isInternal: true });
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  for (const attachment of [false, true]) {
    const [reply] = await db.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: attachment ? "" : "Still need help", imageUrl: attachment ? "/uploads/example.png" : null }).returning();
    assert.equal(await remindInactiveTickets(send, row.id, db), 0);
    // Simulate this new public-activity cycle reaching its reminder window.
    await db.update(schema.tickets).set({ lastCommunicationAt: new Date(row.lastCommunicationAt.getTime() + (attachment ? 2000 : 1000)) }).where(eq(schema.tickets.id, row.id));
    assert.equal(await remindInactiveTickets(send, row.id, db), 3);
    await db.update(schema.ticketMessages).set({ message: "Edited", editedAt: new Date(), readAt: new Date() }).where(eq(schema.ticketMessages.id, reply.id));
    assert.equal(await remindInactiveTickets(send, row.id, db), 0);
  }
  assert.equal(sent, 6);
});

test("a reply winning the ticket lock skips a reminder; failed delivery attempts are not duplicated", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sending = db.transaction(async tx => {
    await tx.select().from(schema.tickets).where(eq(schema.tickets.id, row.id)).for("update");
    await tx.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: "A reply arrived" });
    locked(); await gate;
  });
  await ready;
  try { assert.equal(await remindInactiveTickets(async () => assert.fail("Stale reminder"), row.id, db), 0); }
  finally { release(); await sending; }
  const failing = await reminderTicket();
  let attempts = 0;
  await remindInactiveTickets(async () => { attempts++; throw new Error("Test provider failure"); }, failing.id, db);
  assert.equal(attempts, 2);
  assert.equal(await remindInactiveTickets(async () => { attempts++; }, failing.id, db), 0);
  assert.equal(attempts, 2);
});
