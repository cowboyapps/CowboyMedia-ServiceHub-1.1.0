import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { users, tickets, ticketMessages, ticketMessageReactions } from "@shared/schema";
import { getTicketReactions, setTicketReaction, markVisibleTicketMessagesRead } from "./ticket-messaging-storage";

after(async () => { await pool.end(); });

test("reactions persist one per actor, replace/remove, and cannot outlive concurrent message deletion", async () => {
  const actors = await db.insert(users).values(["customer", "admin", "master_admin"].map(role => ({
    username: `test-messaging-${randomUUID()}`, email: "test@example.invalid", password: "not-a-login-hash",
    fullName: "Messaging regression", role,
  }))).returning();
  const [owner, admin, otherStaff] = actors;
  const ticket = await storage.createTicket({ customerId: owner.id, subject: "Messaging regression", description: "Keep" });
  const ids: string[] = [];
  try {
    const customerMessage = await storage.createTicketMessage({ ticketId: ticket.id, senderId: owner.id, message: "Customer" });
    const staffMessage = await storage.createTicketMessage({ ticketId: ticket.id, senderId: admin.id, message: "Support" });
    const note = await storage.createTicketMessage({ ticketId: ticket.id, senderId: admin.id, message: "Internal", isInternal: true });
    ids.push(customerMessage.id, staffMessage.id, note.id);
    assert.equal(await setTicketReaction(ticket.id, staffMessage.id, owner.id, "👍"), true);
    await Promise.all(Array.from({ length: 4 }, () => setTicketReaction(ticket.id, staffMessage.id, owner.id, "👍")));
    assert.deepEqual((await getTicketReactions(ids, owner.id))[staffMessage.id], [{ emoji: "👍", count: 1, reacted: true }]);
    await setTicketReaction(ticket.id, staffMessage.id, admin.id, "👍");
    assert.deepEqual((await getTicketReactions(ids, otherStaff.id))[staffMessage.id], [{ emoji: "👍", count: 2, reacted: false }]);
    await setTicketReaction(ticket.id, staffMessage.id, owner.id, "❤️");
    assert.equal((await getTicketReactions(ids, owner.id))[staffMessage.id].length, 2);
    await setTicketReaction(ticket.id, staffMessage.id, owner.id, null);
    assert.deepEqual((await getTicketReactions(ids, owner.id))[staffMessage.id], [{ emoji: "👍", count: 1, reacted: false }]);
    assert.equal(await setTicketReaction("other-ticket", staffMessage.id, owner.id, "👍"), false);
    assert.equal(await setTicketReaction(ticket.id, note.id, owner.id, "👍"), false);

    assert.equal(await markVisibleTicketMessagesRead(ticket, otherStaff, [staffMessage.id, note.id]), false,
      "another admin must not label support's message as read by customer");
    assert.equal(await markVisibleTicketMessagesRead(ticket, admin, [customerMessage.id, note.id]), true);
    assert.equal((await storage.getTicketMessage(staffMessage.id))?.readAt, null);
    assert.equal(await markVisibleTicketMessagesRead(ticket, owner, [staffMessage.id]), true);
    assert.equal((await storage.getTicketMessage(note.id))?.readAt, null);
    assert.equal(await markVisibleTicketMessagesRead(ticket, owner, [staffMessage.id]), false);

    await Promise.all([
      setTicketReaction(ticket.id, customerMessage.id, owner.id, "👍"),
      db.delete(ticketMessages).where(eq(ticketMessages.id, customerMessage.id)),
    ]);
    assert.equal((await db.select().from(ticketMessageReactions).where(eq(ticketMessageReactions.messageId, customerMessage.id))).length, 0);
    await db.delete(ticketMessages).where(eq(ticketMessages.id, staffMessage.id));
    assert.deepEqual(await getTicketReactions(ids, owner.id), {});
    assert.equal(await setTicketReaction(ticket.id, staffMessage.id, owner.id, "👍"), false);
  } finally {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
    await db.delete(users).where(inArray(users.id, actors.map(a => a.id)));
  }
});
