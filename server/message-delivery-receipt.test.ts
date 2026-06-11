import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db, pool } from "./db";
import { messageThreads, threadMessages } from "@shared/schema";

// ---------------------------------------------------------------------------
// Storage-level: the delivery-receipt half of the "Sent → Delivered → Read"
// status shown under a sender's own thread messages (real DB).
//
// Task #313's client-side label is unit-tested in test/message-receipt-label.ts,
// but the server logic that decides WHEN a message becomes "Delivered" had no
// coverage. The two trickiest behaviors live here:
//   1. markThreadMessagesDelivered(threadId, recipientId): runs when the sender
//      hits send AND the recipient already has a live socket — it must flip ONLY
//      the messages the recipient RECEIVED (not their own), must be idempotent
//      (never overwrite an earlier deliveredAt), and must stay thread-scoped.
//   2. markUndeliveredThreadMessagesForUser(userId): runs when an offline
//      recipient reconnects — it must flip every pending message addressed to
//      that user across all their threads, leave their OWN messages and other
//      people's threads untouched, and return exactly the affected threads so
//      the route can fan a "Delivered" receipt back to each sender.
// These exercise the real Drizzle queries so a future change to the
// `senderId != userId` / `deliveredAt IS NULL` / participant filters is caught.
// ---------------------------------------------------------------------------

const createdThreadIds: string[] = [];

async function makeThread(adminId: string, customerId: string): Promise<string> {
  const [thread] = await db
    .insert(messageThreads)
    .values({ adminId, customerId, subject: "Delivery receipt fixture" })
    .returning();
  createdThreadIds.push(thread.id);
  return thread.id;
}

async function addMessage(
  threadId: string,
  senderId: string,
  body: string,
  opts: { deliveredAt?: Date | null; readAt?: Date | null } = {},
) {
  const [msg] = await db
    .insert(threadMessages)
    .values({ threadId, senderId, body, deliveredAt: opts.deliveredAt ?? null, readAt: opts.readAt ?? null })
    .returning();
  return msg;
}

async function readMessages(threadId: string) {
  return db.select().from(threadMessages).where(eq(threadMessages.threadId, threadId));
}

// Fresh participant IDs per test. markUndeliveredThreadMessagesForUser is
// user-scoped across EVERY thread the user is in, so reusing a shared customer
// id would let one test's leftover pending messages leak into another's result.
function freshPair() {
  return { adminId: `admin-${randomUUID()}`, customerId: `customer-${randomUUID()}` };
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

// ---------------------------------------------------------------------------
// markThreadMessagesDelivered (send-time flip, recipient already online)
// ---------------------------------------------------------------------------

test("markThreadMessagesDelivered sets deliveredAt ONLY on messages the recipient did not send", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const fromAdmin = await addMessage(threadId, adminId, "Hello from admin");
  const fromCustomer = await addMessage(threadId, customerId, "Reply from customer");

  // The admin sent a message and the customer is the (online) recipient.
  await storage.markThreadMessagesDelivered(threadId, customerId);

  const rows = await readMessages(threadId);
  const adminRow = rows.find((r) => r.id === fromAdmin.id)!;
  const customerRow = rows.find((r) => r.id === fromCustomer.id)!;

  assert.notEqual(adminRow.deliveredAt, null, "the admin's message (received by the customer) is marked delivered");
  assert.equal(customerRow.deliveredAt, null, "the customer's OWN message is never marked delivered for them");
});

test("markThreadMessagesDelivered from the other side marks the admin's received messages, not the customer's own", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const fromCustomer = await addMessage(threadId, customerId, "Customer question");
  const fromAdmin = await addMessage(threadId, adminId, "Admin answer");

  // Symmetric: the customer sent and the admin is the online recipient.
  await storage.markThreadMessagesDelivered(threadId, adminId);

  const rows = await readMessages(threadId);
  assert.notEqual(rows.find((r) => r.id === fromCustomer.id)!.deliveredAt, null, "customer's message marked delivered for the admin");
  assert.equal(rows.find((r) => r.id === fromAdmin.id)!.deliveredAt, null, "admin's own message stays undelivered");
});

test("markThreadMessagesDelivered does not overwrite an already-set deliveredAt (idempotent)", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const earlier = new Date("2025-01-01T00:00:00.000Z");
  const alreadyDelivered = await addMessage(threadId, adminId, "Delivered earlier", { deliveredAt: earlier });
  const stillPending = await addMessage(threadId, adminId, "Not delivered yet");

  await storage.markThreadMessagesDelivered(threadId, customerId);

  const rows = await readMessages(threadId);
  assert.equal(
    rows.find((r) => r.id === alreadyDelivered.id)!.deliveredAt!.getTime(),
    earlier.getTime(),
    "an already-delivered message keeps its original deliveredAt (filter is deliveredAt IS NULL)",
  );
  assert.notEqual(rows.find((r) => r.id === stillPending.id)!.deliveredAt, null, "the still-pending received message gets marked");
});

test("markThreadMessagesDelivered is scoped to the given thread", async () => {
  const { adminId, customerId } = freshPair();
  const threadA = await makeThread(adminId, customerId);
  const threadB = await makeThread(adminId, customerId);
  const inA = await addMessage(threadA, adminId, "Belongs to A");
  const inB = await addMessage(threadB, adminId, "Belongs to B");

  await storage.markThreadMessagesDelivered(threadA, customerId);

  const aRows = await readMessages(threadA);
  const bRows = await readMessages(threadB);
  assert.notEqual(aRows.find((r) => r.id === inA.id)!.deliveredAt, null, "message in the targeted thread is marked");
  assert.equal(bRows.find((r) => r.id === inB.id)!.deliveredAt, null, "a message in a different thread is untouched");
});

test("markThreadMessagesDelivered: Read still takes precedence over Delivered end-to-end", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const readAt = new Date("2025-06-01T12:00:00.000Z");
  // A message that was already read (e.g. recipient opened the thread directly)
  // then a later delivery flip fires from a reconnect/duplicate send.
  const alreadyRead = await addMessage(threadId, adminId, "Seen already", { readAt });

  await storage.markThreadMessagesDelivered(threadId, customerId);

  const row = (await readMessages(threadId)).find((r) => r.id === alreadyRead.id)!;
  assert.equal(row.readAt!.getTime(), readAt.getTime(), "the delivery flip must NOT clobber an existing readAt");
  assert.notEqual(row.deliveredAt, null, "deliveredAt is also stamped, but it's independent of readAt");
  // messageReceiptLabel (unit-tested in test/message-receipt-label.test.ts)
  // returns "Read" whenever readAt is set, regardless of deliveredAt — so a read
  // message never regresses to "Delivered" once delivery is also recorded.
});

// ---------------------------------------------------------------------------
// markUndeliveredThreadMessagesForUser (recipient reconnects after being offline)
// ---------------------------------------------------------------------------

test("markUndeliveredThreadMessagesForUser flips every pending message addressed to the user across all their threads", async () => {
  const { adminId, customerId } = freshPair();
  const threadA = await makeThread(adminId, customerId);
  const threadB = await makeThread(adminId, customerId);

  const aToCustomer = await addMessage(threadA, adminId, "A: waiting for you");
  const aOwn = await addMessage(threadA, customerId, "A: my own pending message");
  const bToCustomer = await addMessage(threadB, adminId, "B: also waiting");

  // The customer reconnects.
  const threads = await storage.markUndeliveredThreadMessagesForUser(customerId);

  const returnedIds = new Set(threads.map((t) => t.id));
  assert.ok(returnedIds.has(threadA), "thread A (had a pending message for the customer) is returned");
  assert.ok(returnedIds.has(threadB), "thread B (had a pending message for the customer) is returned");

  const aRows = await readMessages(threadA);
  const bRows = await readMessages(threadB);
  assert.notEqual(aRows.find((r) => r.id === aToCustomer.id)!.deliveredAt, null, "received message in A is delivered");
  assert.equal(aRows.find((r) => r.id === aOwn.id)!.deliveredAt, null, "the customer's OWN message is never delivered to them");
  assert.notEqual(bRows.find((r) => r.id === bToCustomer.id)!.deliveredAt, null, "received message in B is delivered");
});

test("markUndeliveredThreadMessagesForUser leaves other people's threads untouched", async () => {
  const { adminId, customerId } = freshPair();
  const other = freshPair();
  const myThread = await makeThread(adminId, customerId);
  const strangerThread = await makeThread(other.adminId, other.customerId);

  const mine = await addMessage(myThread, adminId, "For me");
  const notMine = await addMessage(strangerThread, other.adminId, "Not for me");

  const threads = await storage.markUndeliveredThreadMessagesForUser(customerId);

  const returnedIds = new Set(threads.map((t) => t.id));
  assert.ok(returnedIds.has(myThread), "the user's own thread is returned");
  assert.ok(!returnedIds.has(strangerThread), "a thread the user is not a participant of is NOT returned");

  assert.notEqual((await readMessages(myThread)).find((r) => r.id === mine.id)!.deliveredAt, null, "the user's pending message is delivered");
  assert.equal((await readMessages(strangerThread)).find((r) => r.id === notMine.id)!.deliveredAt, null, "the stranger thread's message is untouched");
});

test("markUndeliveredThreadMessagesForUser is idempotent: a thread with nothing pending for the user is not returned", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const earlier = new Date("2025-01-01T00:00:00.000Z");
  // Only message is already delivered + the customer's own pending one.
  const already = await addMessage(threadId, adminId, "Already delivered", { deliveredAt: earlier });
  const own = await addMessage(threadId, customerId, "Customer's own pending");

  const threads = await storage.markUndeliveredThreadMessagesForUser(customerId);

  assert.ok(!new Set(threads.map((t) => t.id)).has(threadId), "no pending received messages → thread not returned");
  const rows = await readMessages(threadId);
  assert.equal(rows.find((r) => r.id === already.id)!.deliveredAt!.getTime(), earlier.getTime(), "already-delivered message keeps its timestamp");
  assert.equal(rows.find((r) => r.id === own.id)!.deliveredAt, null, "the customer's own message is still not delivered to them");
});

test("markUndeliveredThreadMessagesForUser returns each affected thread once even with multiple pending messages", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  const m1 = await addMessage(threadId, adminId, "First pending");
  const m2 = await addMessage(threadId, adminId, "Second pending");

  const threads = await storage.markUndeliveredThreadMessagesForUser(customerId);

  assert.equal(threads.filter((t) => t.id === threadId).length, 1, "the thread appears exactly once, not per-message");
  const rows = await readMessages(threadId);
  assert.notEqual(rows.find((r) => r.id === m1.id)!.deliveredAt, null, "first pending message delivered");
  assert.notEqual(rows.find((r) => r.id === m2.id)!.deliveredAt, null, "second pending message delivered");
});

test("markUndeliveredThreadMessagesForUser does not flip messages addressed to the OTHER participant", async () => {
  const { adminId, customerId } = freshPair();
  const threadId = await makeThread(adminId, customerId);
  // A message the customer sent is "addressed to" the admin — when the CUSTOMER
  // reconnects it must stay pending (the admin hasn't received it via a live
  // socket yet); only the admin reconnecting should flip it.
  const fromCustomer = await addMessage(threadId, customerId, "Customer -> admin, still pending");

  const customerReconnect = await storage.markUndeliveredThreadMessagesForUser(customerId);
  assert.ok(!new Set(customerReconnect.map((t) => t.id)).has(threadId), "customer reconnect does not deliver their own outgoing message");
  assert.equal((await readMessages(threadId)).find((r) => r.id === fromCustomer.id)!.deliveredAt, null, "still pending after the customer reconnects");

  const adminReconnect = await storage.markUndeliveredThreadMessagesForUser(adminId);
  assert.ok(new Set(adminReconnect.map((t) => t.id)).has(threadId), "admin reconnect returns the thread");
  assert.notEqual((await readMessages(threadId)).find((r) => r.id === fromCustomer.id)!.deliveredAt, null, "delivered once the admin reconnects");
});
