import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db, pool } from "./db";
import { communityMessages, communityMessageEdits, communityReactions } from "@shared/schema";
import {
  createCommunityMessageEditHandler,
  createCommunityMessageHistoryHandler,
  type CommunityEditDeps,
  type CommunityEditUser,
  type CommunityEditMessage,
} from "./community-chat-edit";

// ---------------------------------------------------------------------------
// Storage-level: community chat edit history (real DB).
//
// Edit history is moderation-sensitive (it preserves wording an author tried
// to replace), so it must (a) actually persist and read back in newest-first
// order, and (b) be pruned when the message itself is deleted — otherwise
// deleted-message wording would linger in the DB forever with no UI to manage
// it. These run against the real Drizzle queries so a schema/query change is
// caught.
// ---------------------------------------------------------------------------

const AUTHOR_ID = `author-${randomUUID()}`;
const createdMessageIds: string[] = [];

async function makeMessage(content: string): Promise<string> {
  const [msg] = await db
    .insert(communityMessages)
    .values({ userId: AUTHOR_ID, chatUsername: "history-fixture", content })
    .returning();
  createdMessageIds.push(msg.id);
  return msg.id;
}

before(async () => {
  // Fail fast if the DB isn't reachable.
  await db.select().from(communityMessages).limit(1);
});

after(async () => {
  if (createdMessageIds.length) {
    await db.delete(communityReactions).where(inArray(communityReactions.messageId, createdMessageIds));
    await db.delete(communityMessageEdits).where(inArray(communityMessageEdits.messageId, createdMessageIds));
    await db.delete(communityMessages).where(inArray(communityMessages.id, createdMessageIds));
  }
  await pool.end();
});

test("recordCommunityMessageEdit persists and getCommunityMessageEditHistory returns newest-first", async () => {
  const messageId = await makeMessage("current wording");

  await storage.recordCommunityMessageEdit({
    messageId,
    previousContent: "first wording",
    editedBy: AUTHOR_ID,
    editedByUsername: "history-fixture",
  });
  // Distinct createdAt so the DESC ordering is observable.
  await new Promise((r) => setTimeout(r, 20));
  await storage.recordCommunityMessageEdit({
    messageId,
    previousContent: "second wording",
    editedBy: AUTHOR_ID,
    editedByUsername: "history-fixture",
  });

  const edits = await storage.getCommunityMessageEditHistory(messageId);
  assert.equal(edits.length, 2, "both edits are stored");
  assert.equal(edits[0].previousContent, "second wording", "newest edit first");
  assert.equal(edits[1].previousContent, "first wording", "oldest edit last");
  for (const e of edits) {
    assert.equal(e.messageId, messageId);
    assert.equal(e.editedBy, AUTHOR_ID);
    assert.equal(e.editedByUsername, "history-fixture");
  }
});

test("getCommunityMessageEditHistory is scoped to the requested message", async () => {
  const messageA = await makeMessage("A current");
  const messageB = await makeMessage("B current");
  await storage.recordCommunityMessageEdit({
    messageId: messageA,
    previousContent: "A old",
    editedBy: AUTHOR_ID,
    editedByUsername: "history-fixture",
  });

  const aEdits = await storage.getCommunityMessageEditHistory(messageA);
  const bEdits = await storage.getCommunityMessageEditHistory(messageB);
  assert.equal(aEdits.length, 1, "message A sees its own edit");
  assert.equal(bEdits.length, 0, "message B never sees another message's history");
});

test("deleteCommunityMessage prunes the message's edit-history rows", async () => {
  const messageId = await makeMessage("about to be deleted");
  await storage.recordCommunityMessageEdit({
    messageId,
    previousContent: "pre-delete wording",
    editedBy: AUTHOR_ID,
    editedByUsername: "history-fixture",
  });
  const beforeRows = await db.select().from(communityMessageEdits)
    .where(eq(communityMessageEdits.messageId, messageId));
  assert.equal(beforeRows.length, 1, "history row exists before deletion");

  await storage.deleteCommunityMessage(messageId);

  const [msg] = await db.select().from(communityMessages).where(eq(communityMessages.id, messageId));
  assert.equal(msg, undefined, "message row is gone");
  const afterRows = await db.select().from(communityMessageEdits)
    .where(eq(communityMessageEdits.messageId, messageId));
  assert.equal(afterRows.length, 0, "orphaned edit-history rows are pruned with the message");
});

// ---------------------------------------------------------------------------
// Route-level: the REAL handlers from server/community-chat-edit.ts — the
// exact functions server/routes.ts registers behind requireAuth for
// GET /api/community-chat/messages/:id/history and
// PATCH /api/community-chat/messages/:id — mounted with stub deps (same DI
// pattern as server/require-permission.ts).
//
// History is ADMIN-ONLY: a customer must get 403 BEFORE the message lookup
// runs (no existence oracle for non-admins), an admin gets 200 with the locked
// { current, edits } shape, and a missing message 404s. The PATCH handler must
// record a history row ONLY when the wording actually changed — a no-op save
// must not pollute the moderation trail. These tests need no database.
// ---------------------------------------------------------------------------

const USERS = new Map<string, CommunityEditUser>([
  ["admin-1", { id: "admin-1", role: "admin", chatUsername: null, username: "avery", chatBanned: false }],
  ["master-1", { id: "master-1", role: "master_admin", chatUsername: null, username: "morgan", chatBanned: false }],
  ["customer-1", { id: "customer-1", role: "customer", chatUsername: "casey", username: "casey", chatBanned: false }],
]);

function baseMessage(content: string): CommunityEditMessage {
  return {
    id: "msg-1",
    userId: "customer-1",
    content,
    imageUrl: null,
    kbArticleSlug: null,
    pollId: null,
    createdAt: new Date(), // fresh: within the 15-minute author edit window
    editedAt: null,
  };
}

interface HarnessOpts {
  sessionUserId: string;
  messageExists?: boolean;
  messageContent?: string;
}

// Mounts the real handlers with a fake session (requireAuth in routes.ts only
// checks req.session.userId is set; identity resolution happens inside the
// handlers via deps.getUser — the code under test here).
function makeApp(opts: HarnessOpts) {
  const message = baseMessage(opts.messageContent ?? "current wording");
  const edits = [
    { id: "edit-1", messageId: "msg-1", previousContent: "old wording", editedBy: "customer-1", editedByUsername: "casey" },
  ];

  const lookupCalls: string[] = [];
  const historyCalls: string[] = [];
  const recorded: Array<{ messageId: string; previousContent: string; editedBy: string; editedByUsername: string }> = [];
  const broadcasts: unknown[] = [];

  const deps: CommunityEditDeps = {
    async getUser(id) {
      return USERS.get(id);
    },
    async getCommunityMessage(id) {
      lookupCalls.push(id);
      return opts.messageExists === false ? undefined : id === message.id ? message : undefined;
    },
    async getAllWordFilters() {
      return [];
    },
    async updateCommunityMessageContent(id, content, editedAt) {
      if (id !== message.id) return undefined;
      return { ...message, content, editedAt };
    },
    async recordCommunityMessageEdit(edit) {
      recorded.push(edit);
      return edit;
    },
    async getCommunityMessageEditHistory(messageId) {
      historyCalls.push(messageId);
      return edits;
    },
    broadcast(data) {
      broadcasts.push(data);
    },
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { session: { userId: string } }).session = { userId: opts.sessionUserId };
    next();
  });
  app.get("/api/community-chat/messages/:id/history", createCommunityMessageHistoryHandler(deps));
  app.patch("/api/community-chat/messages/:id", createCommunityMessageEditHandler(deps));

  return { app, lookupCalls, historyCalls, recorded, broadcasts, edits };
}

async function request(
  app: express.Express,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${path}`, init)
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("GET /history: customer → 403, and the message is never even looked up", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await request(ctx.app, "/api/community-chat/messages/msg-1/history");

  assert.equal(r.status, 403);
  assert.equal(r.body.error, "Only admins can view edit history");
  assert.equal(ctx.lookupCalls.length, 0, "403 fires before the message lookup (no existence oracle)");
  assert.equal(ctx.historyCalls.length, 0, "history is never fetched for a customer");
});

test("GET /history: admin → 200 with the locked { current, edits } shape", async () => {
  const ctx = makeApp({ sessionUserId: "admin-1" });
  const r = await request(ctx.app, "/api/community-chat/messages/msg-1/history");

  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["current", "edits"]);
  assert.equal(r.body.current.content, "current wording");
  assert.equal(r.body.edits.length, 1);
  assert.equal(r.body.edits[0].previousContent, "old wording");
});

test("GET /history: master_admin is also allowed", async () => {
  const ctx = makeApp({ sessionUserId: "master-1" });
  const r = await request(ctx.app, "/api/community-chat/messages/msg-1/history");
  assert.equal(r.status, 200);
});

test("GET /history: missing message → 404 for an admin", async () => {
  const ctx = makeApp({ sessionUserId: "admin-1", messageExists: false });
  const r = await request(ctx.app, "/api/community-chat/messages/msg-1/history");

  assert.equal(r.status, 404);
  assert.equal(r.body.error, "Message not found");
  assert.equal(ctx.historyCalls.length, 0, "no history fetch for a missing message");
});

// --- PATCH (real handler): record history only when the wording changed ---

test("PATCH edit: changed wording records exactly one history row with the PRIOR content", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1", messageContent: "original wording" });
  const r = await request(ctx.app, "/api/community-chat/messages/msg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "new wording" }),
  });

  assert.equal(r.status, 200);
  assert.equal(ctx.recorded.length, 1, "one history row per real edit");
  assert.equal(ctx.recorded[0].previousContent, "original wording", "history stores the wording that was REPLACED");
  assert.equal(ctx.recorded[0].messageId, "msg-1");
  assert.equal(ctx.recorded[0].editedByUsername, "casey");
});

test("PATCH edit: unchanged wording (incl. whitespace-only difference) records NO history row", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1", messageContent: "same wording" });

  const same = await request(ctx.app, "/api/community-chat/messages/msg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "same wording" }),
  });
  assert.equal(same.status, 200, "no-op save still succeeds");
  assert.equal(ctx.recorded.length, 0, "identical content records nothing");

  const padded = await request(ctx.app, "/api/community-chat/messages/msg-1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "  same wording  " }),
  });
  assert.equal(padded.status, 200);
  assert.equal(ctx.recorded.length, 0, "whitespace-only difference is a no-op (content is trimmed first)");
});
