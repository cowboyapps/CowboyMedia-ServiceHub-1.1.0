import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request } from "express";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { messageThreads, threadMessages, threadMessageReactions, uploadedFiles, adminActivityLogs, type User } from "@shared/schema";
import { createThreadMessagingHandlers } from "./thread-messaging-routes";
import { canAccessThread, deleteThreadMessage, editThreadMessage, enrichThreadMessages, getThreadReactions, markThreadVisibleRead, persistThreadSend, setThreadReaction, ThreadWriteError } from "./thread-messaging-storage";
import { deleteUploadedFileIfUnreferenced } from "./uploaded-file-cleanup";
import { privateMessageUpload, privateSendIds } from "./thread-upload";

after(() => pool.end());

test("private messaging: uploads, retry safety, editing, reactions, visible receipts and revocation", async () => {
  const threadId = randomUUID();
  const otherThreadId = randomUUID();
  const adminId = randomUUID();
  const customerId = randomUUID();
  const outsiderId = randomUUID();
  const supervisorId = randomUUID();
  const events: Array<{ event: Record<string, unknown>; ids: string[] }> = [];
  const actors = new Map<string, User>([
    [adminId, { id: adminId, role: "admin" } as User],
    [customerId, { id: customerId, role: "customer" } as User],
    [outsiderId, { id: outsiderId, role: "admin" } as User],
    [supervisorId, { id: supervisorId, role: "master_admin" } as User],
  ]);
  await db.insert(messageThreads).values([
    { id: threadId, adminId, customerId, subject: "Private regression" },
    { id: otherThreadId, adminId: outsiderId, customerId: randomUUID(), subject: "Other regression" },
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: req.get("x-actor") } as Request["session"];
    next();
  });
  const handlers = createThreadMessagingHandlers({
    getUser: async id => actors.get(id),
    getThread: async id => (await db.select().from(messageThreads).where(eq(messageThreads.id, id)))[0],
    getMessage: async id => (await db.select().from(threadMessages).where(eq(threadMessages.id, id)))[0],
    canManage: async actor => actor.id === adminId,
    edit: editThreadMessage, remove: deleteThreadMessage, react: setThreadReaction, reactions: getThreadReactions,
    markRead: markThreadVisibleRead,
    getUpload: async filename => (await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename)))[0],
    cleanup: deleteUploadedFileIfUnreferenced,
    broadcast: (event, ids) => events.push({ event, ids }),
  });
  app.patch("/api/message-threads/:id/messages/:messageId", handlers.edit);
  app.delete("/api/message-threads/:id/messages/:messageId", handlers.remove);
  app.put("/api/message-threads/:id/messages/:messageId/reaction", handlers.reaction);
  app.patch("/api/message-threads/:id/read", handlers.read);
  app.get("/api/message-threads/:id/messages/:messageId/attachment", handlers.attachment);
  // Same multipart middleware and persistence as both production POST routes,
  // with notifications intentionally absent from the disposable harness.
  app.post("/send/:id", privateMessageUpload, privateSendIds, async (req, res) => {
    try {
      const saved = await persistThreadSend({
        threadId: String(req.params.id), senderId: req.session.userId!,
        body: req.body.body || "", kbArticleSlug: null,
        clientMessageId: req.body.clientMessageId || null, file: req.file,
      });
      res.json((await enrichThreadMessages([saved.message], req.session.userId!))[0]);
    } catch (error) {
      res.status(error instanceof ThreadWriteError ? error.status : 500).json({ message: String(error) });
    }
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const call = (url: string, actor: string = customerId, method = "GET", body?: unknown, headers = {}) => fetch(base + url, {
    method, headers: { "x-actor": actor, ...(body ? { "content-type": "application/json" } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sendVideo = (key = randomUUID(), body = "", size = 48) => {
    const data = new FormData();
    data.append("body", body);
    data.append("clientMessageId", key);
    data.append("image", new Blob([new Uint8Array(size)], { type: "video/mp4" }), "phone clip.mp4");
    return fetch(`${base}/send/${threadId}`, { method: "POST", headers: { "x-actor": customerId }, body: data });
  };
  let filename: string | undefined;
  try {
    const key = randomUUID();
    const sent = await sendVideo(key);
    assert.equal(sent.status, 200);
    const message = await sent.json();
    filename = message.imageUrl.split("/").pop();
    assert.deepEqual(message.attachment, { name: "phone clip.mp4", kind: "video", contentType: "video/mp4" });
    assert.equal(message.editedAt, null);
    assert.equal(message.requestFingerprint, undefined);
    const replay = await sendVideo(key);
    assert.equal((await replay.json()).id, message.id);
    assert.equal((await sendVideo(key, "different payload")).status, 409);
    const concurrentKey = randomUUID();
    const [one, two] = await Promise.all([sendVideo(concurrentKey), sendVideo(concurrentKey)]);
    assert.equal((await one.json()).id, (await two.json()).id);
    assert.equal((await sendVideo(randomUUID(), "", 25 * 1024 * 1024 + 1)).status, 413);
    const oversized = await sendVideo(randomUUID(), "", 25 * 1024 * 1024 + 1);
    assert.match((await oversized.json()).message, /25 MB/);

    const url = `/api/message-threads/${threadId}/messages/${message.id}`;
    assert.equal((await call(url + "/attachment", outsiderId)).status, 403, "unrelated admin cannot download");
    assert.equal((await call(url + "/attachment", "")).status, 401);
    const range = await call(url + "/attachment", customerId, "GET", undefined, { range: "bytes=0-15" });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), "bytes 0-15/48");
    assert.equal(range.headers.get("cache-control"), "no-store");
    assert.equal((await range.arrayBuffer()).byteLength, 16);
    assert.equal((await call(url + "/attachment", customerId, "HEAD")).headers.get("content-length"), "48");
    assert.equal((await call(url + "/attachment", customerId, "GET", undefined, { range: "bytes=999-" })).status, 416);
    const download = await call(url + "/attachment?download=1");
    assert.match(download.headers.get("content-disposition")!, /^attachment;/);
    assert.match(download.headers.get("content-disposition")!, /phone%20clip.mp4/);
    assert.equal((await call(url, adminId, "PATCH", { body: "Not mine", originalBody: "" })).status, 403);
    const edited = await call(url, customerId, "PATCH", { body: "Customer correction", originalBody: "" });
    assert.equal(edited.status, 200);
    assert.ok((await edited.json()).editedAt);
    assert.equal((await call(url, customerId, "PATCH", { body: "Stale", originalBody: "" })).status, 409);
    assert.equal((await call(url, outsiderId, "PATCH", { body: "No access", originalBody: "Customer correction" })).status, 403);

    assert.equal((await call(url + "/reaction", customerId, "PUT", { emoji: "invalid" })).status, 400);
    await call(url + "/reaction", customerId, "PUT", { emoji: "👍" });
    const reacted = await call(url + "/reaction", adminId, "PUT", { emoji: "👍" });
    assert.deepEqual((await reacted.json()).reactions, [{ emoji: "👍", count: 2, reacted: true }]);
    await call(url + "/reaction", customerId, "PUT", { emoji: "❤️" });
    await call(url + "/reaction", customerId, "PUT", { emoji: null });
    assert.deepEqual((await getThreadReactions([message.id], customerId))[message.id], [{ emoji: "👍", count: 1, reacted: false }]);

    const hidden = (await persistThreadSend({ threadId, senderId: customerId, body: "Outside viewport", kbArticleSlug: null, clientMessageId: randomUUID() })).message;
    assert.equal((await call(`/api/message-threads/${threadId}/read`, adminId, "PATCH")).status, 400, "no mark-all on mount");
    assert.equal((await call(`/api/message-threads/${threadId}/read`, customerId, "PATCH", { messageIds: [message.id] })).status, 200);
    assert.equal((await db.select().from(threadMessages).where(eq(threadMessages.id, message.id)))[0].readAt, null, "sender cannot read own message");
    const inspection = await call(`/api/message-threads/${threadId}/read`, supervisorId, "PATCH", { messageIds: [message.id] });
    assert.deepEqual(await inspection.json(), { changed: false }, "supervisor cannot impersonate recipient read receipts");
    await call(`/api/message-threads/${threadId}/read`, adminId, "PATCH", { messageIds: [message.id] });
    assert.ok((await db.select().from(threadMessages).where(eq(threadMessages.id, message.id)))[0].readAt);
    assert.equal((await db.select().from(threadMessages).where(eq(threadMessages.id, hidden.id)))[0].readAt, null);

    const shared = (await db.insert(threadMessages).values({ threadId, senderId: adminId, body: "Shared attachment reference", imageUrl: message.imageUrl }).returning())[0];
    assert.equal((await call(url, customerId, "DELETE")).status, 403);
    const before = (await db.select().from(threadMessages).where(eq(threadMessages.id, message.id)))[0];
    assert.equal(before.body, "Customer correction");
    assert.equal(before.createdAt.toISOString(), message.createdAt);
    assert.equal((await call(url, adminId, "DELETE")).status, 200);
    assert.equal((await call(url + "/attachment")).status, 404);
    assert.equal((await call(url + "/reaction", adminId, "PUT", { emoji: "👍" })).status, 404);
    assert.equal((await db.select().from(threadMessageReactions).where(eq(threadMessageReactions.messageId, message.id))).length, 0);
    assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename!))).length, 1, "retain shared blob");
    assert.equal((await call(`/api/message-threads/${threadId}/messages/${shared.id}`, adminId, "DELETE")).status, 200);
    assert.equal((await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename!))).length, 0);
    const audit = await db.select().from(adminActivityLogs).where(eq(adminActivityLogs.targetId, threadId));
    assert.ok(!JSON.stringify(audit).includes("Customer correction"), "audit contains IDs, not deleted bodies");
    assert.ok(events.every(item => item.ids.length === 2 && item.ids.includes(customerId) && item.ids.includes(adminId)));
    assert.ok(events.every(item => !("message" in item.event) && !("body" in item.event)), "events do not leak message contents");
    assert.equal(canAccessThread(actors.get(outsiderId)!, (await db.select().from(messageThreads).where(eq(messageThreads.id, threadId)))[0]), false);
  } finally {
    const uploads = await db.select({ url: threadMessages.imageUrl }).from(threadMessages).where(eq(threadMessages.threadId, threadId));
    await db.delete(messageThreads).where(eq(messageThreads.id, otherThreadId));
    await db.delete(threadMessages).where(eq(threadMessages.threadId, threadId));
    await db.delete(messageThreads).where(eq(messageThreads.id, threadId));
    await db.delete(adminActivityLogs).where(eq(adminActivityLogs.targetId, threadId));
    for (const item of uploads) if (item.url) await deleteUploadedFileIfUnreferenced(item.url);
    if (filename) await deleteUploadedFileIfUnreferenced(`/uploads/${filename}`);
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test("new-conversation retries reuse both conversation and first message", async () => {
  const threadId = randomUUID();
  const input = {
    threadId, senderId: randomUUID(), body: "First message", clientMessageId: randomUUID(), kbArticleSlug: null,
    newThread: { adminId: "", customerId: randomUUID(), subject: "Retry regression" },
  };
  input.newThread.adminId = input.senderId;
  try {
    const [first, second] = await Promise.all([persistThreadSend(input), persistThreadSend(input)]);
    assert.equal(first.message.id, second.message.id);
    assert.equal((await db.select().from(threadMessages).where(eq(threadMessages.threadId, threadId))).length, 1);
    await assert.rejects(() => persistThreadSend({ ...input, newThread: { ...input.newThread, subject: "Changed" } }), { status: 409 });
  } finally {
    await db.delete(threadMessages).where(eq(threadMessages.threadId, threadId));
    await db.delete(messageThreads).where(eq(messageThreads.id, threadId));
  }
});
