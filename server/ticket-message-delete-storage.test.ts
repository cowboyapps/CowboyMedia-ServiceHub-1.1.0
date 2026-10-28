import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { adminActivityLogs, ticketMessages, tickets, uploadedFiles } from "@shared/schema";
import { deleteUploadedFileIfUnreferenced } from "./uploaded-file-cleanup";

after(async () => { await pool.end(); });
test("concurrent deletes commit one metadata-only audit; future transcript reads exclude deleted message and preserve shared media", async () => {
  const ticket = await storage.createTicket({ subject: "Deletion regression", description: "Original", customerId: randomUUID() });
  const filename = `${randomUUID()}.png`;
  const url = `/uploads/${filename}`;
  await db.insert(uploadedFiles).values({ filename, mimetype: "image/png", data: "eA==" });
  try {
    const removed = await storage.createTicketMessage({ ticketId: ticket.id, senderId: randomUUID(), message: "Deleted private words", imageUrl: url, kbArticleSlug: "keep-article" });
    const kept = await storage.createTicketMessage({ ticketId: ticket.id, senderId: randomUUID(), message: "Remaining words", imageUrl: url });
    await storage.createTicketMessage({ ticketId: ticket.id, senderId: randomUUID(), message: "Private internal note", isInternal: true });
    const results = await Promise.all([1, 2].map(() => storage.deleteTicketMessageWithAudit(ticket.id, removed.id, "test-actor")));
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await storage.getTicketMessage(removed.id), undefined);
    assert.deepEqual((await storage.getTicketMessages(ticket.id, false)).map((m) => m.id), [kept.id], "same authoritative read used by customer/admin close transcripts");
    assert.equal((await storage.getTicketMessages(ticket.id, true)).length, 2);
    const logs = await db.select().from(adminActivityLogs).where(eq(adminActivityLogs.targetId, ticket.id));
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actorId, "test-actor");
    assert.equal(JSON.parse(logs[0].details!).messageId, removed.id);
    assert.ok(!JSON.stringify(logs).includes("Deleted private words"));
    assert.ok(!JSON.stringify(logs).includes(filename));
    await deleteUploadedFileIfUnreferenced(url);
    assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename))).length, 1);
    await storage.deleteTicketMessageWithAudit(ticket.id, kept.id, "test-actor");
    await deleteUploadedFileIfUnreferenced(url);
    assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename))).length, 0);
    assert.equal((await storage.getTicket(ticket.id))?.description, "Original");
  } finally {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
    await db.delete(adminActivityLogs).where(eq(adminActivityLogs.targetId, ticket.id));
    await db.delete(uploadedFiles).where(eq(uploadedFiles.filename, filename));
  }
});
