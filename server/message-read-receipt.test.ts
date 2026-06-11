import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db, pool } from "./db";
import { messageThreads, threadMessages } from "@shared/schema";

// ---------------------------------------------------------------------------
// Storage-level: markThreadMessagesRead (real DB).
//
// The read-receipt only works if marking a thread read sets `readAt` on the
// messages the reader RECEIVED (sent by the other participant) and never on the
// reader's OWN messages — otherwise a sender would see "· Read" the instant they
// hit send, before the other side ever opened the thread. These tests exercise
// the real Drizzle query against the DB so a future change to the
// `senderId != userId` / `readAt IS NULL` / thread-scoping filter is caught.
// ---------------------------------------------------------------------------

const ADMIN_ID = `admin-${randomUUID()}`;
const CUSTOMER_ID = `customer-${randomUUID()}`;
const createdThreadIds: string[] = [];

async function makeThread(): Promise<string> {
  const [thread] = await db
    .insert(messageThreads)
    .values({ adminId: ADMIN_ID, customerId: CUSTOMER_ID, subject: "Read receipt fixture" })
    .returning();
  createdThreadIds.push(thread.id);
  return thread.id;
}

async function addMessage(threadId: string, senderId: string, body: string, readAt: Date | null = null) {
  const [msg] = await db
    .insert(threadMessages)
    .values({ threadId, senderId, body, readAt })
    .returning();
  return msg;
}

async function readMessages(threadId: string) {
  return db.select().from(threadMessages).where(eq(threadMessages.threadId, threadId));
}

before(async () => {
  // Fail fast (and skip cleanly) if the DB isn't reachable.
  await db.select().from(messageThreads).limit(1);
});

after(async () => {
  if (createdThreadIds.length) {
    await db.delete(threadMessages).where(inArray(threadMessages.threadId, createdThreadIds));
    await db.delete(messageThreads).where(inArray(messageThreads.id, createdThreadIds));
  }
  await pool.end();
});

test("markThreadMessagesRead sets readAt ONLY on messages the reader did not send", async () => {
  const threadId = await makeThread();
  const fromAdmin = await addMessage(threadId, ADMIN_ID, "Hello from admin");
  const fromCustomer = await addMessage(threadId, CUSTOMER_ID, "Reply from customer");

  // The customer opens the thread.
  await storage.markThreadMessagesRead(threadId, CUSTOMER_ID);

  const rows = await readMessages(threadId);
  const adminRow = rows.find((r) => r.id === fromAdmin.id)!;
  const customerRow = rows.find((r) => r.id === fromCustomer.id)!;

  assert.notEqual(adminRow.readAt, null, "the admin's message (received by the customer) is marked read");
  assert.equal(customerRow.readAt, null, "the customer's OWN message is never marked read by their own open");
});

test("markThreadMessagesRead from the admin marks the customer's messages, not the admin's own", async () => {
  const threadId = await makeThread();
  const fromCustomer = await addMessage(threadId, CUSTOMER_ID, "Customer question");
  const fromAdmin = await addMessage(threadId, ADMIN_ID, "Admin answer");

  // Symmetric to the customer case: the admin opening marks the OTHER side.
  await storage.markThreadMessagesRead(threadId, ADMIN_ID);

  const rows = await readMessages(threadId);
  assert.notEqual(rows.find((r) => r.id === fromCustomer.id)!.readAt, null, "customer's message marked read for the admin");
  assert.equal(rows.find((r) => r.id === fromAdmin.id)!.readAt, null, "admin's own message stays unread");
});

test("markThreadMessagesRead does not overwrite an already-set readAt", async () => {
  const threadId = await makeThread();
  const earlier = new Date("2025-01-01T00:00:00.000Z");
  const alreadyRead = await addMessage(threadId, ADMIN_ID, "Seen earlier", earlier);
  const stillUnread = await addMessage(threadId, ADMIN_ID, "Not seen yet");

  await storage.markThreadMessagesRead(threadId, CUSTOMER_ID);

  const rows = await readMessages(threadId);
  assert.equal(
    rows.find((r) => r.id === alreadyRead.id)!.readAt!.getTime(),
    earlier.getTime(),
    "an already-read message keeps its original readAt (filter is readAt IS NULL)",
  );
  assert.notEqual(rows.find((r) => r.id === stillUnread.id)!.readAt, null, "the still-unread received message gets marked");
});

test("markThreadMessagesRead is scoped to the given thread", async () => {
  const threadA = await makeThread();
  const threadB = await makeThread();
  const inA = await addMessage(threadA, ADMIN_ID, "Belongs to A");
  const inB = await addMessage(threadB, ADMIN_ID, "Belongs to B");

  await storage.markThreadMessagesRead(threadA, CUSTOMER_ID);

  const aRows = await readMessages(threadA);
  const bRows = await readMessages(threadB);
  assert.notEqual(aRows.find((r) => r.id === inA.id)!.readAt, null, "message in the opened thread is marked");
  assert.equal(bRows.find((r) => r.id === inB.id)!.readAt, null, "a message in a different thread is untouched");
});

// ---------------------------------------------------------------------------
// Route-level wiring: PATCH /api/message-threads/:id/read.
//
// Mirrors the security-relevant wiring of the real route (server/routes.ts):
// thread lookup -> participant/master_admin gate -> markThreadMessagesRead ->
// broadcast `thread_messages_read` to BOTH participants. The receipt has to
// reach both sides (the reader to clear their unread badge, the sender to flip
// their bubble to "· Read"), so the broadcast spy asserts the recipient set and
// payload. These tests need no database.
// ---------------------------------------------------------------------------

type FakeUser = { id: string; role: string };
type FakeThread = { id: string; adminId: string; customerId: string };

function makeReadApp(opts: { sessionUserId: string; threadExists?: boolean }) {
  const users = new Map<string, FakeUser>([
    ["admin-1", { id: "admin-1", role: "admin" }],
    ["master-1", { id: "master-1", role: "master_admin" }],
    ["customer-1", { id: "customer-1", role: "customer" }],
    ["customer-2", { id: "customer-2", role: "customer" }],
  ]);
  const thread: FakeThread = { id: "thread-1", adminId: "admin-1", customerId: "customer-1" };

  const markReadCalls: Array<{ threadId: string; userId: string }> = [];
  const broadcasts: Array<{ data: any; participants: string[] }> = [];

  async function getMessageThread(id: string) {
    return opts.threadExists === false ? undefined : id === thread.id ? thread : undefined;
  }
  async function getUser(id: string) {
    return users.get(id);
  }
  async function markThreadMessagesRead(threadId: string, userId: string) {
    markReadCalls.push({ threadId, userId });
  }
  function broadcastToThreadParticipants(data: any, participants: string[]) {
    broadcasts.push({ data, participants });
  }

  const app = express();
  app.patch("/api/message-threads/:id/read", async (req, res) => {
    try {
      const t = await getMessageThread(req.params.id);
      if (!t) return res.status(404).json({ message: "Thread not found" });
      const reqUser = await getUser(opts.sessionUserId);
      if (t.adminId !== opts.sessionUserId && t.customerId !== opts.sessionUserId && reqUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await markThreadMessagesRead(req.params.id, opts.sessionUserId);
      broadcastToThreadParticipants(
        { type: "thread_messages_read", threadId: req.params.id, readBy: opts.sessionUserId },
        [t.adminId, t.customerId],
      );
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return { app, markReadCalls, broadcasts };
}

async function patchRead(app: express.Express, threadId = "thread-1"): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}/api/message-threads/${threadId}/read`, { method: "PATCH" })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("PATCH /read: a participant marks read → 200 and broadcasts thread_messages_read to BOTH participants", async () => {
  const ctx = makeReadApp({ sessionUserId: "customer-1" });
  const r = await patchRead(ctx.app);

  assert.equal(r.status, 200);
  assert.deepEqual(ctx.markReadCalls, [{ threadId: "thread-1", userId: "customer-1" }]);
  assert.equal(ctx.broadcasts.length, 1, "exactly one broadcast");
  assert.deepEqual(ctx.broadcasts[0].data, {
    type: "thread_messages_read",
    threadId: "thread-1",
    readBy: "customer-1",
  });
  assert.deepEqual(
    new Set(ctx.broadcasts[0].participants),
    new Set(["admin-1", "customer-1"]),
    "both the admin and the customer receive the receipt",
  );
});

test("PATCH /read: the admin participant also reaches both sides", async () => {
  const ctx = makeReadApp({ sessionUserId: "admin-1" });
  const r = await patchRead(ctx.app);

  assert.equal(r.status, 200);
  assert.deepEqual(ctx.markReadCalls, [{ threadId: "thread-1", userId: "admin-1" }]);
  assert.equal(ctx.broadcasts[0].data.readBy, "admin-1");
  assert.deepEqual(new Set(ctx.broadcasts[0].participants), new Set(["admin-1", "customer-1"]));
});

test("PATCH /read: a master_admin who is not a participant may still mark read", async () => {
  const ctx = makeReadApp({ sessionUserId: "master-1" });
  const r = await patchRead(ctx.app);

  assert.equal(r.status, 200);
  assert.deepEqual(ctx.markReadCalls, [{ threadId: "thread-1", userId: "master-1" }]);
  assert.deepEqual(
    new Set(ctx.broadcasts[0].participants),
    new Set(["admin-1", "customer-1"]),
    "the receipt still targets the real participants, not the master_admin",
  );
});

test("PATCH /read: a non-participant, non-master_admin is rejected 403 and nothing is marked or broadcast", async () => {
  const ctx = makeReadApp({ sessionUserId: "customer-2" });
  const r = await patchRead(ctx.app);

  assert.equal(r.status, 403);
  assert.equal(ctx.markReadCalls.length, 0, "no messages marked read on a forbidden request");
  assert.equal(ctx.broadcasts.length, 0, "no receipt broadcast on a forbidden request");
});

test("PATCH /read: a missing thread → 404 and nothing is marked or broadcast", async () => {
  const ctx = makeReadApp({ sessionUserId: "customer-1", threadExists: false });
  const r = await patchRead(ctx.app);

  assert.equal(r.status, 404);
  assert.equal(ctx.markReadCalls.length, 0);
  assert.equal(ctx.broadcasts.length, 0);
});
