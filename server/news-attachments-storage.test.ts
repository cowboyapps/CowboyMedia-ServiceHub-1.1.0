import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db, pool } from "./db";
import { storage } from "./storage";
import { newsStories, ticketMessages, tickets, threadMessages, messageThreads, communityMessages, adminActivityLogs } from "@shared/schema";
import { persistThreadSend, enrichThreadMessages, threadRequestFingerprint, ThreadWriteError, editThreadMessage } from "./thread-messaging-storage";
import { enrichNewsArticlesForMessages } from "./news-attachments";

after(async () => { await pool.end(); });

test("news references persist in all three conversations and private retries compare the attached news", async () => {
  const actor = randomUUID(), newsId = randomUUID(), secondNewsId = randomUUID(), threadId = randomUUID();
  const ticket = await storage.createTicket({ customerId: randomUUID(), subject: "News reference verification", description: "Test only", status: "closed", priority: "normal" });
  let communityId: string | undefined;
  try {
    await db.insert(newsStories).values([
      { id: newsId, title: "Automated news verification", content: "<p>Test only</p>", authorId: actor },
      { id: secondNewsId, title: "Second news verification", content: "<p>Test only</p>", authorId: actor },
    ]);
    const reply = await storage.createTicketMessage({ ticketId: ticket.id, senderId: actor, message: "", newsArticleId: newsId });
    assert.equal((await storage.getTicketMessage(reply.id))?.newsArticleId, newsId);
    const community = await storage.createCommunityMessage({ userId: actor, chatUsername: "Verification", content: "", newsArticleId: newsId });
    communityId = community.id;
    assert.equal((await storage.getCommunityMessage(community.id))?.newsArticleId, newsId);
    const input = { threadId, senderId: actor, body: "Caption", kbArticleSlug: null, newsArticleId: newsId,
      clientMessageId: randomUUID(), newThread: { adminId: actor, customerId: randomUUID(), subject: "News reference verification" } };
    const sent = await persistThreadSend(input);
    assert.equal(sent.message.newsArticleId, newsId);
    const repeated = await persistThreadSend(input);
    assert.equal(repeated.replay, true);
    assert.equal(repeated.message.id, sent.message.id);
    await assert.rejects(persistThreadSend({ ...input, newsArticleId: secondNewsId }), (error: unknown) =>
      error instanceof ThreadWriteError && error.status === 409);
    const enriched = await enrichThreadMessages([sent.message], actor);
    assert.equal(enriched[0].newsArticle?.title, "Automated news verification");
    const edited = await editThreadMessage(threadId, sent.message.id, actor, "", "Caption");
    assert.equal(edited.newsArticleId, newsId, "clearing caption preserves the linked article");
    await db.delete(newsStories).where(eq(newsStories.id, newsId));
    const missing = await enrichNewsArticlesForMessages([reply, community], storage);
    assert.ok(missing.every(message => message.newsArticle === null && message.newsArticleId === newsId));
    assert.equal((await storage.getCommunityMessage(community.id))?.id, community.id, "deleting news does not delete the conversation");
  } finally {
    if (communityId) await db.delete(communityMessages).where(eq(communityMessages.id, communityId));
    await db.delete(threadMessages).where(eq(threadMessages.threadId, threadId));
    await db.delete(messageThreads).where(eq(messageThreads.id, threadId));
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, ticket.id));
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
    await db.delete(adminActivityLogs).where(inArray(adminActivityLogs.targetId, [ticket.id, threadId]));
    await db.delete(newsStories).where(inArray(newsStories.id, [newsId, secondNewsId]));
  }
});

test("old private-message retry fingerprints remain compatible when no news is attached", async () => {
  const legacy = createHash("sha256").update(JSON.stringify(["Hello", null, undefined, null])).digest("hex");
  assert.equal(await threadRequestFingerprint("Hello", null), legacy);
  assert.equal(await threadRequestFingerprint("Hello", null, undefined, null), legacy);
  assert.notEqual(await threadRequestFingerprint("Hello", null, undefined, "news-one"), legacy);
});
