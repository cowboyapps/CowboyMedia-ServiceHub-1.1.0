import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { adminActivityLogs, messageThreads, threadMessages, threadMessageReactions, uploadedFiles, userNotifications, type MessageThread, type ThreadMessage, type User } from "@shared/schema";
import { TICKET_REACTION_EMOJIS, type TicketReactionSummary } from "@shared/ticket-reactions";
import { privateFileBytes, storePrivateFile } from "./thread-file-storage";
import { retainPrivateUpload } from "./thread-upload";
import { privateUploadError } from "@shared/private-message-uploads";

export function canAccessThread(actor: Pick<User, "id" | "role">, thread: MessageThread) {
  return actor.id === thread.adminId || actor.id === thread.customerId || actor.role === "master_admin";
}

export function uploadContentType(file: Pick<Express.Multer.File, "mimetype" | "originalname">) {
  const extensions: Record<string, string> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".m4v": "video/x-m4v", ".webm": "video/webm", ".avi": "video/x-msvideo", ".mkv": "video/x-matroska", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };
  return !file.mimetype || file.mimetype === "application/octet-stream"
    ? extensions[path.extname(file.originalname).toLowerCase()] || "application/octet-stream" : file.mimetype;
}

export async function threadRequestFingerprint(body: string, kbArticleSlug: string | null, file?: Express.Multer.File) {
  const hash = createHash("sha256").update(JSON.stringify([body, kbArticleSlug, file?.originalname, file ? uploadContentType(file) : null]));
  if (file) for await (const bytes of privateFileBytes(file)) hash.update(bytes);
  return hash.digest("hex");
}

export class ThreadWriteError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Lock the conversation before checking a retry key or changing its latest time.
 * Persist the upload in the same transaction so no failed send or retry orphans it. */
export async function persistThreadSend(input: {
  threadId: string; senderId: string; body: string; kbArticleSlug: string | null;
  clientMessageId: string | null; file?: Express.Multer.File;
  newThread?: { adminId: string; customerId: string; subject: string };
}) {
  const release = retainPrivateUpload(input.file);
  try {
  const rejection = input.file ? privateUploadError(input.file) : null;
  if (rejection) throw new ThreadWriteError(413, rejection);
  const fingerprint = await threadRequestFingerprint(input.body, input.kbArticleSlug, input.file);
  return await db.transaction(async tx => {
    if (input.newThread) {
      await tx.insert(messageThreads).values({ id: input.threadId, ...input.newThread }).onConflictDoNothing();
    }
    const [thread] = await tx.select().from(messageThreads).where(eq(messageThreads.id, input.threadId)).for("update");
    if (!thread) throw new ThreadWriteError(404, "Conversation no longer exists");
    if (input.newThread && (thread.adminId !== input.senderId || thread.customerId !== input.newThread.customerId || thread.subject !== input.newThread.subject)) {
      throw new ThreadWriteError(409, "This send ID was already used for a different conversation");
    }
    if (input.clientMessageId) {
      const [existing] = await tx.select().from(threadMessages).where(and(
        eq(threadMessages.threadId, thread.id), eq(threadMessages.senderId, input.senderId),
        eq(threadMessages.clientMessageId, input.clientMessageId),
      ));
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new ThreadWriteError(409, "This send ID was already used for different content");
        return { thread, message: existing, replay: true };
      }
    }
    let imageUrl: string | null = null;
    if (input.file) {
      const filename = `${randomUUID()}${path.extname(input.file.originalname).replace(/[^a-zA-Z0-9.]/g, "").slice(0, 16)}`;
      await storePrivateFile(tx, input.file, filename, uploadContentType(input.file));
      imageUrl = `/uploads/${filename}`;
    }
    const [message] = await tx.insert(threadMessages).values({
      threadId: thread.id, senderId: input.senderId, body: input.body, kbArticleSlug: input.kbArticleSlug,
      imageUrl, clientMessageId: input.clientMessageId, requestFingerprint: fingerprint,
      attachmentName: input.file?.originalname ?? null,
      attachmentType: input.file ? uploadContentType(input.file) : null,
    }).returning();
    await tx.update(messageThreads).set({ lastMessageAt: message.createdAt }).where(eq(messageThreads.id, thread.id));
    return { thread, message, replay: false };
  });
  } finally { release(); }
}

export async function getThreadReactions(ids: string[], actorId: string): Promise<Record<string, TicketReactionSummary[]>> {
  if (!ids.length) return {};
  const rows = await db.select({
    messageId: threadMessageReactions.messageId, emoji: threadMessageReactions.emoji,
    count: sql<number>`count(*)::int`, reacted: sql<boolean>`bool_or(${threadMessageReactions.userId} = ${actorId})`,
  }).from(threadMessageReactions).where(inArray(threadMessageReactions.messageId, ids))
    .groupBy(threadMessageReactions.messageId, threadMessageReactions.emoji);
  const result: Record<string, TicketReactionSummary[]> = {};
  for (const row of rows) (result[row.messageId] ??= []).push({ emoji: row.emoji, count: row.count, reacted: row.reacted });
  for (const reactions of Object.values(result)) reactions.sort((a, b) => TICKET_REACTION_EMOJIS.indexOf(a.emoji) - TICKET_REACTION_EMOJIS.indexOf(b.emoji));
  return result;
}

export async function enrichThreadMessages(messages: ThreadMessage[], actorId: string) {
  const reactions = await getThreadReactions(messages.map(m => m.id), actorId);
  const filenames = messages.flatMap(m => m.imageUrl?.match(/^\/uploads\/([^/?#]+)$/)?.[1] ?? []);
  // Metadata only: never read every attachment's base64 data for a history GET.
  const uploads = filenames.length ? await db.select({ filename: uploadedFiles.filename, mimetype: uploadedFiles.mimetype })
    .from(uploadedFiles).where(inArray(uploadedFiles.filename, filenames)) : [];
  const types = new Map(uploads.map(file => [file.filename, file.mimetype]));
  return messages.map(({ requestFingerprint: _fingerprint, ...m }) => {
    const filename = m.imageUrl?.split("/").pop() || "";
    const contentType = m.attachmentType || types.get(filename) || "application/octet-stream";
    const kind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : "file";
    return { ...m, reactions: reactions[m.id] ?? [], attachment: m.imageUrl ? { name: m.attachmentName || filename, kind, contentType } : null };
  });
}

export async function editThreadMessage(threadId: string, messageId: string, actorId: string, body: string, originalBody: string) {
  return db.transaction(async tx => {
    const [current] = await tx.select().from(threadMessages).where(and(eq(threadMessages.id, messageId), eq(threadMessages.threadId, threadId))).for("update");
    if (!current) throw new ThreadWriteError(404, "Message no longer exists");
    if (current.senderId !== actorId) throw new ThreadWriteError(403, "You can only edit your own messages");
    if (current.body !== originalBody) throw new ThreadWriteError(409, "This message changed. Close the editor and reopen it to edit the latest version.");
    if (!body && !current.imageUrl && !current.kbArticleSlug) throw new ThreadWriteError(400, "A message cannot be empty");
    if (body === current.body) return current;
    const [message] = await tx.update(threadMessages).set({ body, editedAt: new Date() }).where(eq(threadMessages.id, messageId)).returning();
    await tx.insert(adminActivityLogs).values({ actorId, category: "messages", action: "thread_message_edited", targetId: threadId, targetType: "message_thread", summary: "Edited a sent message", details: JSON.stringify({ messageId }) });
    return message;
  });
}

export async function deleteThreadMessage(threadId: string, messageId: string, actorId: string) {
  return db.transaction(async tx => {
    const [thread] = await tx.select().from(messageThreads).where(eq(messageThreads.id, threadId)).for("update");
    if (!thread) throw new ThreadWriteError(404, "Conversation no longer exists");
    const [message] = await tx.delete(threadMessages).where(and(eq(threadMessages.id, messageId), eq(threadMessages.threadId, threadId))).returning();
    if (!message) throw new ThreadWriteError(404, "Message no longer exists");
    const [latest] = await tx.select({ createdAt: threadMessages.createdAt }).from(threadMessages)
      .where(eq(threadMessages.threadId, threadId)).orderBy(desc(threadMessages.createdAt)).limit(1);
    await tx.update(messageThreads).set({ lastMessageAt: latest?.createdAt ?? thread.createdAt }).where(eq(messageThreads.id, threadId));
    // Notification previews can contain the deleted body: clear conversation
    // notification content without removing unrelated notifications.
    await tx.update(userNotifications).set({ body: "Open the conversation to view messages." })
      .where(and(eq(userNotifications.type, "message"), eq(userNotifications.referenceId, threadId)));
    await tx.insert(adminActivityLogs).values({ actorId, category: "messages", action: "thread_message_deleted", targetId: threadId, targetType: "message_thread", summary: "Deleted a message for everyone", details: JSON.stringify({ messageId }) });
    return message;
  });
}

export async function setThreadReaction(threadId: string, messageId: string, actorId: string, emoji: string | null) {
  return db.transaction(async tx => {
    const [message] = await tx.select().from(threadMessages).where(and(eq(threadMessages.id, messageId), eq(threadMessages.threadId, threadId))).for("update");
    if (!message) throw new ThreadWriteError(404, "Message no longer exists");
    if (emoji === null) await tx.delete(threadMessageReactions).where(and(eq(threadMessageReactions.messageId, messageId), eq(threadMessageReactions.userId, actorId)));
    else await tx.insert(threadMessageReactions).values({ messageId, userId: actorId, emoji }).onConflictDoUpdate({
      target: [threadMessageReactions.messageId, threadMessageReactions.userId], set: { emoji, createdAt: new Date() },
    });
  });
}

export async function markThreadVisibleRead(threadId: string, actorId: string, ids: string[]) {
  if (!ids.length) return false;
  const read = await db.update(threadMessages).set({ readAt: new Date(), deliveredAt: sql`coalesce(${threadMessages.deliveredAt}, now())` })
    .where(and(eq(threadMessages.threadId, threadId), inArray(threadMessages.id, ids), ne(threadMessages.senderId, actorId), isNull(threadMessages.readAt)))
    .returning({ id: threadMessages.id });
  return read.length > 0;
}
