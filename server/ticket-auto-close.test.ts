import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import express from "express";
import type { Server } from "node:http";
import * as schema from "@shared/schema";
import { db as mainDb, pool as mainPool } from "./db";
import { closeInactiveTickets, createTicketAutoCloseHandlers, getTicketAutoCloseSettings, remindInactiveTickets } from "./ticket-auto-close";
import { createRequireAdmin } from "./require-permission";
import { createTicketAutoCloseHoldHandler } from "./ticket-auto-close-hold";
import { ticketInvalidationEvent } from "@shared/ticket-events";
import { automatedClosureMessage, ticketAutoCloseSettingsSchema, DEFAULT_TICKET_AUTO_CLOSE_MESSAGE } from "@shared/ticket-auto-close";

const namespace = `ticket_inactivity_test_${randomUUID().replaceAll("-", "")}`;
let pool: Pool;
let db: typeof mainDb;
let server: Server;
let url: string;
const holdEvents: unknown[] = [];
const old = () => new Date(Date.now() - 8 * 86400000);

before(async () => {
  // A separate schema prevents tests enabling automatic closure on real development tickets.
  await mainPool.query(`CREATE SCHEMA "${namespace}"`);
  for (const table of ["users", "tickets", "ticket_messages", "app_settings", "admin_activity_logs", "ticket_notifications", "user_notifications", "ticket_reminder_attempts"]) {
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
  app.patch("/holds/:id", guard, createTicketAutoCloseHoldHandler({
    getUser: async id => ({ id, role: id === "master_admin" ? "master_admin" : id === "customer" ? "customer" : "admin", fullName: "Test admin" }) as schema.User,
    canAccess: async (actor, ticket) => actor.role === "master_admin" || (ticket.categoryId !== "restricted" && (!ticket.claimedBy || ticket.claimedBy === actor.id)),
    onUpdated: ticketId => { holdEvents.push(ticketInvalidationEvent("ticket_updated", ticketId)); },
  }, db));
  app.get("/history/:id", guard, handlers.history);
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

async function hold(id: string, body: unknown, role = "admin") {
  return fetch(url.replace("/settings", `/holds/${id}`), {
    method: "PATCH", headers: { "x-test-role": role, "content-type": "application/json" }, body: JSON.stringify(body),
  });
}
const holdInput = (reason = "Awaiting provider", expiresAt: string | null = null) => ({ enabled: true, reason, expiresAt });

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

test("hold routes reject unauthorized roles, inaccessible categories, other claims, closed tickets and invalid inputs", async () => {
  const row = await ticket();
  for (const [role, status] of [["", 401], ["customer", 403]] as const) {
    assert.equal((await hold(row.id, holdInput(), role)).status, status);
  }
  for (const input of [holdInput(" "), holdInput("a".repeat(2001)), holdInput("Reason", "bad"), holdInput("Reason", old().toISOString()), { ...holdInput(), extra: true }]) {
    assert.equal((await hold(row.id, input)).status, 400);
  }
  await db.update(schema.tickets).set({ categoryId: "restricted" }).where(eq(schema.tickets.id, row.id));
  assert.equal((await hold(row.id, holdInput())).status, 403);
  assert.equal((await hold(row.id, holdInput(), "master_admin")).status, 200);
  await db.update(schema.tickets).set({ categoryId: null, claimedBy: "someone-else" }).where(eq(schema.tickets.id, row.id));
  assert.equal((await hold(row.id, holdInput())).status, 403);
  await db.update(schema.tickets).set({ status: "closed" }).where(eq(schema.tickets.id, row.id));
  assert.equal((await hold(row.id, holdInput(), "master_admin")).status, 409);
  assert.equal((await hold(randomUUID(), holdInput())).status, 404);
});

test("holds protect stale tickets, update and remove with permanent audit, and never reset communication", async () => {
  await policy();
  const row = await ticket();
  assert.equal((await hold(row.id, holdInput("  Investigating  "))).status, 200);
  assert.deepEqual(holdEvents.at(-1), { type: "ticket_updated", ticket: { id: row.id } });
  assert.equal((await state(row.id)).autoCloseHoldReason, "Investigating");
  assert.equal((await state(row.id)).autoCloseHoldBy, "admin");
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.equal((await hold(row.id, holdInput("Provider escalated", future))).status, 200);
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
  assert.equal((await state(row.id)).lastCommunicationAt.toISOString(), row.lastCommunicationAt.toISOString());
  assert.equal((await hold(row.id, { enabled: false })).status, 200);
  assert.equal((await state(row.id)).autoCloseHoldReason, null);
  const logs = await db.select().from(schema.adminActivityLogs).where(eq(schema.adminActivityLogs.targetId, row.id));
  assert.equal(logs.length, 3);
  const removed = logs.find(log => log.action === "ticket_auto_close_hold_removed")!;
  assert.equal(JSON.parse(removed.details!).previous.reason, "Provider escalated");
  assert.equal(JSON.parse(removed.details!).previous.expiresAt, future);
  assert.equal(removed.actorId, "admin");
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 1);
});

test("expired holds resume original inactivity eligibility; global off still wins; manual closure remains allowed", async () => {
  const row = await ticket();
  await db.update(schema.tickets).set({ autoCloseHoldReason: "Expired provider wait", autoCloseHoldUntil: old() }).where(eq(schema.tickets.id, row.id));
  await policy(false);
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
  await policy();
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 1);
  const manual = await ticket();
  await hold(manual.id, holdInput());
  await db.update(schema.tickets).set({ status: "closed" }).where(eq(schema.tickets.id, manual.id));
  assert.equal((await state(manual.id)).status, "closed");
});

test("hold audit failure rolls back protection rather than silently losing history", async () => {
  const row = await ticket();
  await db.execute(sql.raw(`CREATE TRIGGER fail_hold_audit BEFORE INSERT ON admin_activity_logs FOR EACH ROW EXECUTE FUNCTION "${namespace}".reject_audit()`));
  try { assert.equal((await hold(row.id, holdInput())).status, 500); }
  finally { await db.execute(sql.raw("DROP TRIGGER fail_hold_audit ON admin_activity_logs")); }
  assert.equal((await state(row.id)).autoCloseHoldReason, null);
});

test("hold winning the ticket lock blocks a sweep; closure winning rejects a late hold", async () => {
  await policy();
  const row = await ticket();
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>(resolve => { locked = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const setting = db.transaction(async tx => {
    await tx.select().from(schema.tickets).where(eq(schema.tickets.id, row.id)).for("update");
    await tx.update(schema.tickets).set({ autoCloseHoldReason: "Investigating under lock" }).where(eq(schema.tickets.id, row.id));
    locked();
    await gate;
  });
  await ready;
  try { assert.equal(await closeInactiveTickets(undefined, row.id, db), 0); }
  finally { release(); await setting; }
  assert.equal(await closeInactiveTickets(undefined, row.id, db), 0);
  const closing = await ticket();
  await closeInactiveTickets(undefined, closing.id, db);
  assert.equal((await hold(closing.id, holdInput())).status, 409);
});

test("a full batch of indefinite holds cannot starve an eligible ticket", async () => {
  await policy();
  await db.insert(schema.tickets).values(Array.from({ length: 101 }, () => ({
    subject: "Held investigation", description: "Provider wait", customerId: randomUUID(),
    lastCommunicationAt: new Date(Date.now() - 30 * 86400000), autoCloseHoldReason: "Indefinite hold",
  })));
  const eligible = await ticket();
  await closeInactiveTickets(undefined, undefined, db);
  assert.equal((await state(eligible.id)).status, "closed");
});

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

async function attemptsFor(id: string) {
  return db.select().from(schema.ticketReminderAttempts).where(eq(schema.ticketReminderAttempts.ticketId, id));
}
async function retryNow(id: string) {
  await db.update(schema.ticketReminderAttempts).set({ retryAt: new Date(Date.now() - 1000) })
    .where(eq(schema.ticketReminderAttempts.ticketId, id));
}

test("history records per-channel outcomes and is restricted to admins", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  await remindInactiveTickets(async r => r.channel === "email"
    ? { status: "failed", detail: "Provider rejected request (HTTP 403).", retryable: false }
    : { status: "succeeded", detail: "Push accepted." }, row.id, db);
  const records = await attemptsFor(row.id);
  assert.equal(records.length, 3);
  assert.equal(records.find(r => r.channel === "in_app")?.status, "succeeded");
  assert.equal(records.find(r => r.channel === "push")?.status, "succeeded");
  assert.equal(records.find(r => r.channel === "email")?.status, "failed");
  assert.ok(records.every(r => r.finishedAt && r.attempt === 1));
  const historyUrl = url.replace("/settings", `/history/${row.id}`);
  for (const [role, status] of [["", 401], ["customer", 403], ["admin", 200], ["master_admin", 200]] as const) {
    const response = await fetch(historyUrl, { headers: { "x-test-role": role } });
    assert.equal(response.status, status);
    if (status === 200) {
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await response.json()).length, 3);
    }
  }
  assert.equal((await fetch(url.replace("/settings", "/history/missing"), { headers: { "x-test-role": "admin" } })).status, 404);
  await retryNow(row.id);
  assert.equal(await remindInactiveTickets(async () => assert.fail("Success and permanent failures must not retry"), row.id, db), 0);
});

test("rate-limit failures back off, retry independently and never replay successes", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  await remindInactiveTickets(async r => r.channel === "email"
    ? { status: "failed", detail: "Rate limited.", retryable: true }
    : { status: "succeeded", detail: "Push accepted on at least one device." }, row.id, db);
  const failed = (await attemptsFor(row.id)).find(r => r.channel === "email")!;
  assert.equal(failed.retryable, true);
  assert.ok(failed.retryAt!.getTime() >= failed.finishedAt!.getTime() + 299000);
  assert.equal(await remindInactiveTickets(async () => assert.fail("Too early"), row.id, db), 0);
  await retryNow(row.id);
  const sent: string[] = [];
  const send = async (r: Parameters<Parameters<typeof remindInactiveTickets>[0]>[0]) => {
    sent.push(r.channel);
    return { status: "succeeded" as const, detail: "Email accepted." };
  };
  await Promise.all([remindInactiveTickets(send, row.id, db), remindInactiveTickets(send, row.id, db)]);
  assert.deepEqual(sent, ["email"]);
  assert.equal((await attemptsFor(row.id)).filter(r => r.channel === "email").length, 2);
  await retryNow(row.id);
  assert.equal(await remindInactiveTickets(send, row.id, db), 0);
});

test("rate-limit retries stop after three attempts and preserve every result", async () => {
  await reminderPolicy();
  const row = await reminderTicket(6, { ticket_reply: { in_app: false, push: false, email: true } });
  const send = async () => ({ status: "failed" as const, detail: "Rate limited.", retryable: true });
  for (let n = 1; n <= 3; n++) {
    await retryNow(row.id);
    assert.equal(await remindInactiveTickets(send, row.id, db), 1);
    const rows = await attemptsFor(row.id);
    assert.equal(rows.length, n);
    assert.equal(rows.find(r => r.attempt === n)?.retryable, n < 3);
  }
  await retryNow(row.id);
  assert.equal(await remindInactiveTickets(async () => assert.fail("Retry budget exhausted"), row.id, db), 0);
});

test("retries cannot send expired, closed, disabled, quiet-hours or old-activity reminders", async () => {
  for (const change of ["expired", "closed", "disabled", "policy", "reply", "quiet", "preference", "hold"] as const) {
    await reminderPolicy();
    const row = await reminderTicket(6, { ticket_reply: { in_app: false, push: false, email: true } });
    await remindInactiveTickets(async () => ({ status: "failed", detail: "Rate limited.", retryable: true }), row.id, db);
    await retryNow(row.id);
    if (change === "expired") await db.update(schema.tickets).set({ lastCommunicationAt: old() }).where(eq(schema.tickets.id, row.id));
    if (change === "closed") await db.update(schema.tickets).set({ status: "closed" }).where(eq(schema.tickets.id, row.id));
    if (change === "hold") await db.update(schema.tickets).set({ autoCloseHoldReason: "Investigation in progress" }).where(eq(schema.tickets.id, row.id));
    if (change === "disabled") await reminderPolicy(false);
    if (change === "policy") await policy(true, 8);
    if (change === "reply") await db.insert(schema.ticketMessages).values({ ticketId: row.id, senderId: randomUUID(), message: "New public activity" });
    if (change === "quiet") {
      const minute = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
      const hhmm = (n: number) => `${String(Math.floor((n + 1440) % 1440 / 60)).padStart(2, "0")}:${String((n + 1440) % 60).padStart(2, "0")}`;
      await db.update(schema.users).set({ quietHoursEnabled: true, quietHoursStart: hhmm(minute - 60), quietHoursEnd: hhmm(minute + 60), quietHoursTimezone: "UTC" }).where(eq(schema.users.id, row.customerId));
    }
    if (change === "preference") await db.update(schema.users).set({ notificationPrefs: { ticket_reply: { in_app: false, push: false, email: false } } }).where(eq(schema.users.id, row.customerId));
    assert.equal(await remindInactiveTickets(async () => assert.fail(`Unsafe ${change} retry`), row.id, db), 0, change);
    assert.equal((await attemptsFor(row.id)).length, 1);
  }
});

test("a process killed during sending leaves durable unconfirmed claims that never retry", { timeout: 30000 }, async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  const child = fork(new URL("./test-fixtures/reminder-interruption.ts", import.meta.url), [namespace, row.id], {
    execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", data => { stderr += data; });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Worker did not reach send: ${stderr}`)), 15000);
      child.once("message", () => { clearTimeout(timer); resolve(); });
      child.once("exit", code => { clearTimeout(timer); reject(new Error(`Worker exited ${code}: ${stderr}`)); });
    });
    // Claims are visible in a separate connection even while provider send is pending.
    const claimed = await attemptsFor(row.id);
    assert.equal(claimed.filter(r => r.status === "attempted").length, 2);
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    assert.equal(await remindInactiveTickets(async () => assert.fail("Ambiguous interrupted sends must not replay"), row.id, db), 0);
    assert.equal((await attemptsFor(row.id)).filter(r => r.status === "attempted" && !r.retryable && !r.finishedAt).length, 2);
  } finally {
    child.kill("SIGKILL");
  }
});

test("a preference change between claimed channels records cancellation instead of reporting success", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  const sent: string[] = [];
  await remindInactiveTickets(async r => {
    sent.push(r.channel);
    if (r.channel === "push") await db.update(schema.users).set({
      notificationPrefs: { ticket_reply: { in_app: true, push: true, email: false } },
    }).where(eq(schema.users.id, row.customerId));
    return { status: "succeeded", detail: "Push accepted." };
  }, row.id, db);
  assert.deepEqual(sent, ["push"]);
  const email = (await attemptsFor(row.id)).find(r => r.channel === "email")!;
  assert.equal(email.status, "failed");
  assert.equal(email.retryable, false);
  assert.match(email.detail, /Not sent: customer preferences/);
});

test("an outcome write rollback cannot turn an accepted reminder into a duplicate", async () => {
  await reminderPolicy();
  const row = await reminderTicket();
  let calls = 0;
  await pool.query(`CREATE FUNCTION fail_reminder_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated interruption persisting result'; END $$`);
  await pool.query(`CREATE TRIGGER fail_reminder_result BEFORE UPDATE ON ticket_reminder_attempts FOR EACH ROW EXECUTE FUNCTION fail_reminder_result()`);
  try {
    await assert.rejects(remindInactiveTickets(async () => { calls++; return { status: "succeeded", detail: "Provider accepted." }; }, row.id, db), /Simulated interruption/);
  } finally {
    await pool.query("DROP TRIGGER fail_reminder_result ON ticket_reminder_attempts");
    await pool.query("DROP FUNCTION fail_reminder_result()");
  }
  assert.equal(calls, 1);
  assert.equal(await remindInactiveTickets(async () => assert.fail("Accepted but unrecorded send must not replay"), row.id, db), 0);
});
