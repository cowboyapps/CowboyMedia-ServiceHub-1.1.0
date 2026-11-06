import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { adminActivityLogs, ticketMessages, tickets } from "@shared/schema";

after(async () => { await pool.end(); });
test("editing preserves attachments/read receipts and transcript identity; concurrent saves cannot overwrite newer text", async () => {
  const ticket = await storage.createTicket({
    customerId: `edit-test-${randomUUID()}`, subject: "Edit test", description: "Original ticket",
    status: "closed", priority: "normal",
  });
  try {
    const original = await storage.createTicketMessage({
      ticketId: ticket.id, senderId: "edit-test-admin", message: "Old private reply",
      imageUrl: "/uploads/retained.png", kbArticleSlug: "retained-article", isInternal: false,
    });
    const readAt = new Date("2026-01-01T00:00:00Z");
    await db.update(ticketMessages).set({ readAt }).where(eq(ticketMessages.id, original.id));
    const results = await Promise.all([
      storage.editTicketMessageWithAudit(ticket.id, original.id, original.senderId, "Edited private reply", original.message),
      storage.editTicketMessageWithAudit(ticket.id, original.id, original.senderId, "Stale private reply", original.message),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    const saved = results.find(Boolean)!;
    assert.equal(saved.id, original.id);
    assert.equal(saved.imageUrl, original.imageUrl);
    assert.equal(saved.kbArticleSlug, original.kbArticleSlug);
    assert.equal(saved.readAt?.getTime(), readAt.getTime());
    assert.equal(saved.createdAt.getTime(), original.createdAt.getTime());
    const transcriptMessages = await storage.getTicketMessages(ticket.id, false);
    assert.equal(transcriptMessages.length, 1);
    assert.equal(transcriptMessages[0].message, saved.message);
    assert.equal(await storage.editTicketMessageWithAudit(ticket.id, original.id, "different-admin", "Unauthorized"), undefined);
    assert.equal(await storage.editTicketMessageWithAudit("different-ticket", original.id, original.senderId, "Unauthorized"), undefined);
    const logs = await db.select().from(adminActivityLogs).where(eq(adminActivityLogs.targetId, ticket.id));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].action, "ticket_message_edited");
    assert.equal(JSON.parse(logs[0].details!).messageId, original.id);
    assert.ok(!JSON.stringify(logs).includes("private reply"), "edit audit must not preserve deleted message contents");
  } finally {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(adminActivityLogs).where(eq(adminActivityLogs.targetId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
  }
});
