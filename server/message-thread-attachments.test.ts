import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import { resolveKbAttachmentForSender } from "./message-attachments";
import type { CommunityChatKbStorage } from "./community-chat-kb";
import type { KbArticle, KbCategory } from "../shared/schema";

// ---------- Shared KB fixtures ----------

const CATEGORY: KbCategory = {
  id: "cat-1",
  slug: "billing",
  name: "Billing",
  description: null,
  sortOrder: 0,
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

const PUBLISHED_ARTICLE: KbArticle = {
  id: "art-1",
  categoryId: "cat-1",
  slug: "how-to-pay",
  title: "How to pay",
  summary: "Pay your bill in 3 steps",
  bodyHtml: "<p>Pay here</p>",
  tags: [],
  published: true,
  viewCount: 0,
  helpfulCount: 0,
  unhelpfulCount: 0,
  sortOrder: 0,
  authorId: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const UNPUBLISHED_ARTICLE: KbArticle = { ...PUBLISHED_ARTICLE, id: "art-2", slug: "draft-only", published: false };

function mockKbStorage(): CommunityChatKbStorage {
  const articles: Record<string, KbArticle | undefined> = {
    [PUBLISHED_ARTICLE.slug]: PUBLISHED_ARTICLE,
    [UNPUBLISHED_ARTICLE.slug]: UNPUBLISHED_ARTICLE,
  };
  const categories: Record<string, KbCategory | undefined> = { [CATEGORY.id]: CATEGORY };
  return {
    async getKbArticleBySlug(slug) {
      return articles[slug];
    },
    async getKbCategory(id) {
      return categories[id];
    },
  };
}

// ---------- Unit: resolveKbAttachmentForSender (the security gate) ----------

test("resolveKbAttachmentForSender: empty slug always allowed, returns null attachment (any sender)", async () => {
  for (const isAdminSending of [true, false]) {
    const r = await resolveKbAttachmentForSender({ rawKbSlug: "", isAdminSending }, mockKbStorage());
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.kbArticleSlug, null);
      assert.equal(r.kbArticleInfo, null);
    }
  }
});

test("resolveKbAttachmentForSender: whitespace-only slug is treated as no attachment", async () => {
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "   ", isAdminSending: false }, mockKbStorage());
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.kbArticleSlug, null);
});

test("resolveKbAttachmentForSender: non-admin attaching a (valid) KB slug is rejected 403", async () => {
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "how-to-pay", isAdminSending: false }, mockKbStorage());
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 403);
    assert.match(r.error, /only admins/i);
  }
});

test("resolveKbAttachmentForSender: admin attaching an unknown slug is rejected 400", async () => {
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "ghost-slug", isAdminSending: true }, mockKbStorage());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("resolveKbAttachmentForSender: admin attaching an unpublished slug is rejected 400", async () => {
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "draft-only", isAdminSending: true }, mockKbStorage());
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("resolveKbAttachmentForSender: admin attaching a valid published slug resolves the envelope", async () => {
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "how-to-pay", isAdminSending: true }, mockKbStorage());
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.kbArticleSlug, "how-to-pay");
    assert.deepEqual(r.kbArticleInfo, {
      slug: "how-to-pay",
      title: "How to pay",
      categoryName: "Billing",
      summary: "Pay your bill in 3 steps",
    });
  }
});

test("resolveKbAttachmentForSender: admin gate is checked BEFORE the slug is looked up (non-admin + bad slug still 403)", async () => {
  let lookups = 0;
  const spyStorage: CommunityChatKbStorage = {
    async getKbArticleBySlug(slug) {
      lookups++;
      return undefined;
    },
    async getKbCategory() {
      return undefined;
    },
  };
  const r = await resolveKbAttachmentForSender({ rawKbSlug: "ghost-slug", isAdminSending: false }, spyStorage);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 403);
  assert.equal(lookups, 0, "non-admin rejection must not even hit the KB store");
});

// ---------- Route-level: POST /api/message-threads/:id/messages ----------
// Mirrors the security-relevant wiring of the real route (server/routes.ts):
// participant check -> resolveKbAttachmentForSender -> presence check ->
// saveUploadedFile. The saveUploadedFile spy lets us assert that a REJECTED
// request never persists an uploaded file (no orphaned blob), and that
// image-only / KB-only payloads succeed with an empty body.

type FakeUser = { id: string; role: string };
type FakeThread = { id: string; adminId: string; customerId: string; subject: string };
type CreatedMessage = { threadId: string; senderId: string; body: string; imageUrl: string | null; kbArticleSlug: string | null };

function makeApp(opts: { sessionUserId: string }) {
  const users = new Map<string, FakeUser>([
    ["admin-1", { id: "admin-1", role: "admin" }],
    ["master-1", { id: "master-1", role: "master_admin" }],
    ["customer-1", { id: "customer-1", role: "customer" }],
    ["customer-2", { id: "customer-2", role: "customer" }],
  ]);
  const thread: FakeThread = { id: "thread-1", adminId: "admin-1", customerId: "customer-1", subject: "Help" };

  const savedFiles: Express.Multer.File[] = [];
  const createdMessages: CreatedMessage[] = [];

  async function saveUploadedFile(file: Express.Multer.File): Promise<string> {
    savedFiles.push(file);
    return `/uploads/${file.originalname}`;
  }

  const kbStorage = mockKbStorage();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  const app = express();

  app.post("/api/message-threads/:id/messages", upload.single("image"), async (req, res) => {
    try {
      if (thread.id !== req.params.id) return res.status(404).json({ message: "Thread not found" });
      const reqUser = users.get(opts.sessionUserId);
      if (thread.adminId !== opts.sessionUserId && thread.customerId !== opts.sessionUserId && reqUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const isAdminSending = reqUser?.role === "master_admin" || reqUser?.role === "admin" || opts.sessionUserId === thread.adminId;

      const rawBody = typeof req.body.body === "string" ? req.body.body : "";
      const body = rawBody.trim();

      const rawKbSlug = typeof req.body.kbArticleSlug === "string" ? req.body.kbArticleSlug : "";
      const kbDecision = await resolveKbAttachmentForSender({ rawKbSlug, isAdminSending }, kbStorage);
      if (!kbDecision.ok) {
        return res.status(kbDecision.status).json({ message: kbDecision.error });
      }
      const kbArticleSlug = kbDecision.kbArticleSlug;

      if (!body && !req.file && !kbArticleSlug) {
        return res.status(400).json({ message: "A message, image, or article is required" });
      }

      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;
      const msg: CreatedMessage = { threadId: thread.id, senderId: opts.sessionUserId, body, imageUrl, kbArticleSlug };
      createdMessages.push(msg);
      res.json(msg);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return { app, savedFiles, createdMessages };
}

function pngBlob(): Blob {
  // 1x1 transparent PNG.
  const bytes = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000154a24f6f0000000049454e44ae426082",
    "hex",
  );
  return new Blob([bytes], { type: "image/png" });
}

async function postMessages(
  app: express.Express,
  fields: { body?: string; kbArticleSlug?: string; image?: boolean },
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const form = new FormData();
      if (fields.body !== undefined) form.append("body", fields.body);
      if (fields.kbArticleSlug !== undefined) form.append("kbArticleSlug", fields.kbArticleSlug);
      if (fields.image) form.append("image", pngBlob(), "shot.png");
      fetch(`http://127.0.0.1:${port}/api/message-threads/thread-1/messages`, { method: "POST", body: form })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("route: non-admin attaching a KB article (no image) → 403 and nothing persisted", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await postMessages(ctx.app, { kbArticleSlug: "how-to-pay" });
  assert.equal(r.status, 403);
  assert.match(r.body.message, /only admins/i);
  assert.equal(ctx.savedFiles.length, 0);
  assert.equal(ctx.createdMessages.length, 0, "no message row created on rejection");
});

test("route: non-admin attaching a KB article WITH an image → 403 and NO file persisted", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await postMessages(ctx.app, { kbArticleSlug: "how-to-pay", image: true });
  assert.equal(r.status, 403);
  assert.equal(ctx.savedFiles.length, 0, "uploaded file must NOT be persisted when the KB rule rejects");
  assert.equal(ctx.createdMessages.length, 0);
});

test("route: admin attaching an invalid KB slug WITH an image → 400 and NO file persisted", async () => {
  const ctx = makeApp({ sessionUserId: "admin-1" });
  const r = await postMessages(ctx.app, { kbArticleSlug: "ghost-slug", image: true });
  assert.equal(r.status, 400);
  assert.equal(ctx.savedFiles.length, 0, "uploaded file must NOT be persisted when the slug is invalid");
  assert.equal(ctx.createdMessages.length, 0);
});

test("route: message with ONLY an image (empty body, no KB) → 200, persisted with imageUrl", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await postMessages(ctx.app, { image: true });
  assert.equal(r.status, 200);
  assert.equal(ctx.savedFiles.length, 1);
  assert.equal(ctx.createdMessages.length, 1);
  assert.equal(ctx.createdMessages[0].body, "", "empty body allowed for image-only message");
  assert.equal(ctx.createdMessages[0].imageUrl, "/uploads/shot.png");
  assert.equal(ctx.createdMessages[0].kbArticleSlug, null);
});

test("route: message with ONLY a KB link (admin, empty body, no image) → 200, persisted with slug", async () => {
  const ctx = makeApp({ sessionUserId: "admin-1" });
  const r = await postMessages(ctx.app, { kbArticleSlug: "how-to-pay" });
  assert.equal(r.status, 200);
  assert.equal(ctx.savedFiles.length, 0);
  assert.equal(ctx.createdMessages.length, 1);
  assert.equal(ctx.createdMessages[0].body, "", "empty body allowed for KB-only message");
  assert.equal(ctx.createdMessages[0].kbArticleSlug, "how-to-pay");
  assert.equal(ctx.createdMessages[0].imageUrl, null);
});

test("route: empty payload (no body, no image, no KB) → 400, nothing persisted", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await postMessages(ctx.app, {});
  assert.equal(r.status, 400);
  assert.equal(ctx.savedFiles.length, 0);
  assert.equal(ctx.createdMessages.length, 0);
});

test("route: customer sending a plain text reply (no KB) still succeeds", async () => {
  const ctx = makeApp({ sessionUserId: "customer-1" });
  const r = await postMessages(ctx.app, { body: "thanks!" });
  assert.equal(r.status, 200);
  assert.equal(ctx.createdMessages.length, 1);
  assert.equal(ctx.createdMessages[0].body, "thanks!");
  assert.equal(ctx.createdMessages[0].kbArticleSlug, null);
});

// ---------- Route-level: POST /api/message-threads (start a conversation) ----------
// Mirrors the security-relevant wiring of the real route (server/routes.ts):
// requirePermission("messages.manage") -> resolveKbAttachmentForSender (isAdminSending
// always true here) -> required-field + presence checks -> customer lookup ->
// saveUploadedFile -> createMessageThread + createThreadMessage. The saveUploadedFile
// spy proves a REJECTED request never persists an uploaded file (no orphaned blob),
// and that image-only / KB-only thread creation succeeds with an empty body. The
// permission gate is exercised so a non-admin caller never reaches the handler.

type CreatedThread = { id: string; adminId: string; customerId: string; subject: string };

function makeThreadApp(opts: { sessionUserId: string }) {
  const users = new Map<string, FakeUser>([
    ["admin-1", { id: "admin-1", role: "admin" }],
    ["master-1", { id: "master-1", role: "master_admin" }],
    ["customer-1", { id: "customer-1", role: "customer" }],
  ]);

  const savedFiles: Express.Multer.File[] = [];
  const createdThreads: CreatedThread[] = [];
  const createdMessages: CreatedMessage[] = [];

  async function saveUploadedFile(file: Express.Multer.File): Promise<string> {
    savedFiles.push(file);
    return `/uploads/${file.originalname}`;
  }

  const kbStorage = mockKbStorage();
  const storage = {
    ...kbStorage,
    async getUser(id: string) {
      const u = users.get(id);
      return u ? ({ id: u.id, role: u.role, fullName: u.id, email: null } as any) : undefined;
    },
    async createMessageThread(input: { adminId: string; customerId: string; subject: string }) {
      const thread: CreatedThread = { id: "thread-new", ...input };
      createdThreads.push(thread);
      return thread as any;
    },
    async createThreadMessage(input: { threadId: string; senderId: string; body: string; imageUrl: string | null; kbArticleSlug: string | null }) {
      const msg: CreatedMessage = { ...input };
      createdMessages.push(msg);
      return { id: "msg-new", ...input } as any;
    },
  };

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
  const app = express();

  // Stand-in for requirePermission("messages.manage"): only admins / master_admins
  // ever reach the handler. A customer is rejected 403 before any work happens.
  function requireManage(req: express.Request, res: express.Response, next: express.NextFunction) {
    const u = users.get(opts.sessionUserId);
    if (!u || (u.role !== "admin" && u.role !== "master_admin")) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  }

  app.post("/api/message-threads", requireManage, upload.single("image"), async (req, res) => {
    try {
      const customerId = typeof req.body.customerId === "string" ? req.body.customerId : "";
      const subject = typeof req.body.subject === "string" ? req.body.subject : "";
      const rawBody = typeof req.body.body === "string" ? req.body.body : "";
      const body = rawBody.trim();

      const rawKbSlug = typeof req.body.kbArticleSlug === "string" ? req.body.kbArticleSlug : "";
      const kbDecision = await resolveKbAttachmentForSender({ rawKbSlug, isAdminSending: true }, storage);
      if (!kbDecision.ok) {
        return res.status(kbDecision.status).json({ message: kbDecision.error });
      }
      const kbArticleSlug = kbDecision.kbArticleSlug;

      if (!customerId || !subject) {
        return res.status(400).json({ message: "customerId and subject are required" });
      }
      if (!body && !req.file && !kbArticleSlug) {
        return res.status(400).json({ message: "A message, image, or article is required" });
      }
      const customer = await storage.getUser(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      if (customer.role !== "customer") return res.status(400).json({ message: "Can only start conversations with customers" });

      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;

      const thread = await storage.createMessageThread({ adminId: opts.sessionUserId, customerId, subject });
      const msg = await storage.createThreadMessage({ threadId: thread.id, senderId: opts.sessionUserId, body, imageUrl, kbArticleSlug });
      res.json({ thread, message: msg });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return { app, savedFiles, createdThreads, createdMessages };
}

async function postThread(
  app: express.Express,
  fields: { customerId?: string; subject?: string; body?: string; kbArticleSlug?: string; image?: boolean },
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const form = new FormData();
      if (fields.customerId !== undefined) form.append("customerId", fields.customerId);
      if (fields.subject !== undefined) form.append("subject", fields.subject);
      if (fields.body !== undefined) form.append("body", fields.body);
      if (fields.kbArticleSlug !== undefined) form.append("kbArticleSlug", fields.kbArticleSlug);
      if (fields.image) form.append("image", pngBlob(), "shot.png");
      fetch(`http://127.0.0.1:${port}/api/message-threads`, { method: "POST", body: form })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("route POST /api/message-threads: admin attaching an invalid KB slug WITH an image → 400 and NO file persisted", async () => {
  const ctx = makeThreadApp({ sessionUserId: "admin-1" });
  const r = await postThread(ctx.app, { customerId: "customer-1", subject: "Help", kbArticleSlug: "ghost-slug", image: true });
  assert.equal(r.status, 400);
  assert.equal(ctx.savedFiles.length, 0, "uploaded file must NOT be persisted when the slug is invalid");
  assert.equal(ctx.createdThreads.length, 0, "no thread created on rejection");
  assert.equal(ctx.createdMessages.length, 0, "no message created on rejection");
});

test("route POST /api/message-threads: admin attaching an unpublished KB slug WITH an image → 400 and NO file persisted", async () => {
  const ctx = makeThreadApp({ sessionUserId: "admin-1" });
  const r = await postThread(ctx.app, { customerId: "customer-1", subject: "Help", kbArticleSlug: "draft-only", image: true });
  assert.equal(r.status, 400);
  assert.equal(ctx.savedFiles.length, 0, "uploaded file must NOT be persisted when the slug is unpublished");
  assert.equal(ctx.createdThreads.length, 0);
  assert.equal(ctx.createdMessages.length, 0);
});

test("route POST /api/message-threads: image-only thread (empty body, no KB) → 200, persisted with imageUrl", async () => {
  const ctx = makeThreadApp({ sessionUserId: "admin-1" });
  const r = await postThread(ctx.app, { customerId: "customer-1", subject: "Help", image: true });
  assert.equal(r.status, 200);
  assert.equal(ctx.savedFiles.length, 1);
  assert.equal(ctx.createdThreads.length, 1);
  assert.equal(ctx.createdMessages.length, 1);
  assert.equal(ctx.createdMessages[0].body, "", "empty body allowed for image-only thread");
  assert.equal(ctx.createdMessages[0].imageUrl, "/uploads/shot.png");
  assert.equal(ctx.createdMessages[0].kbArticleSlug, null);
});

test("route POST /api/message-threads: KB-only thread (empty body, no image) → 200, persisted with slug", async () => {
  const ctx = makeThreadApp({ sessionUserId: "admin-1" });
  const r = await postThread(ctx.app, { customerId: "customer-1", subject: "Help", kbArticleSlug: "how-to-pay" });
  assert.equal(r.status, 200);
  assert.equal(ctx.savedFiles.length, 0);
  assert.equal(ctx.createdThreads.length, 1);
  assert.equal(ctx.createdMessages.length, 1);
  assert.equal(ctx.createdMessages[0].body, "", "empty body allowed for KB-only thread");
  assert.equal(ctx.createdMessages[0].kbArticleSlug, "how-to-pay");
  assert.equal(ctx.createdMessages[0].imageUrl, null);
});

test("route POST /api/message-threads: non-admin caller is rejected by the permission gate → 403, nothing persisted", async () => {
  const ctx = makeThreadApp({ sessionUserId: "customer-1" });
  const r = await postThread(ctx.app, { customerId: "customer-1", subject: "Help", body: "hi" });
  assert.equal(r.status, 403);
  assert.equal(ctx.savedFiles.length, 0);
  assert.equal(ctx.createdThreads.length, 0, "the route stays admin-gated");
  assert.equal(ctx.createdMessages.length, 0);
});
