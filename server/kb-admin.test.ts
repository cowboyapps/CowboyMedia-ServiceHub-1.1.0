import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createKbAdminHandlers,
  type KbAdminStorage,
  type LogActivityFn,
} from "./kb-admin";
import {
  insertKbCategorySchema,
  updateKbCategorySchema,
  insertKbArticleSchema,
  updateKbArticleSchema,
  type KbCategory,
  type KbArticle,
  type InsertKbCategory,
  type UpdateKbCategory,
  type InsertKbArticle,
  type UpdateKbArticle,
} from "../shared/schema";

const SAMPLE_CATEGORY: KbCategory = {
  id: "cat-1",
  slug: "billing",
  name: "Billing",
  description: "Billing questions",
  sortOrder: 0,
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

const SAMPLE_ARTICLE: KbArticle = {
  id: "art-1",
  categoryId: "cat-1",
  slug: "how-to-pay",
  title: "How to pay",
  summary: null,
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

// ---------- Schema: KB category ----------

test("insertKbCategorySchema: accepts valid payload", () => {
  const r = insertKbCategorySchema.safeParse({
    slug: "billing",
    name: "Billing",
    description: "desc",
    sortOrder: 1,
  });
  assert.equal(r.success, true);
});

test("insertKbCategorySchema: requires slug + name", () => {
  assert.equal(insertKbCategorySchema.safeParse({}).success, false);
  assert.equal(
    insertKbCategorySchema.safeParse({ name: "X" }).success,
    false,
    "slug required",
  );
  assert.equal(
    insertKbCategorySchema.safeParse({ slug: "x" }).success,
    false,
    "name required",
  );
});

test("insertKbCategorySchema: rejects bad slug formats", () => {
  for (const bad of ["Billing", "with space", "double--hyphen", "-leading", "trailing-", "UPPER"]) {
    assert.equal(
      insertKbCategorySchema.safeParse({ slug: bad, name: "X" }).success,
      false,
      `slug "${bad}" should be rejected`,
    );
  }
});

test("insertKbCategorySchema: rejects oversize fields", () => {
  assert.equal(
    insertKbCategorySchema.safeParse({ slug: "a".repeat(121), name: "X" }).success,
    false,
  );
  assert.equal(
    insertKbCategorySchema.safeParse({ slug: "ok", name: "x".repeat(121) }).success,
    false,
  );
  assert.equal(
    insertKbCategorySchema.safeParse({
      slug: "ok",
      name: "X",
      description: "x".repeat(501),
    }).success,
    false,
  );
});

test("insertKbCategorySchema: rejects empty/whitespace name", () => {
  assert.equal(
    insertKbCategorySchema.safeParse({ slug: "ok", name: "" }).success,
    false,
  );
});

test("insertKbCategorySchema: accepts null description", () => {
  const r = insertKbCategorySchema.safeParse({ slug: "ok", name: "X", description: null });
  assert.equal(r.success, true);
});

test("updateKbCategorySchema: accepts empty payload", () => {
  assert.equal(updateKbCategorySchema.safeParse({}).success, true);
});

test("updateKbCategorySchema: accepts partial payload", () => {
  assert.equal(
    updateKbCategorySchema.safeParse({ name: "Renamed" }).success,
    true,
  );
});

test("updateKbCategorySchema: rejects invalid partial slug", () => {
  assert.equal(
    updateKbCategorySchema.safeParse({ slug: "BAD SLUG" }).success,
    false,
  );
});

// ---------- Schema: KB article ----------

const validArticle = {
  categoryId: "cat-1",
  slug: "how-to-pay",
  title: "How to pay",
  bodyHtml: "<p>Pay here</p>",
};

test("insertKbArticleSchema: accepts valid payload", () => {
  assert.equal(insertKbArticleSchema.safeParse(validArticle).success, true);
});

test("insertKbArticleSchema: requires categoryId, slug, title, body", () => {
  assert.equal(insertKbArticleSchema.safeParse({}).success, false);
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, categoryId: "" }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, title: "" }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, bodyHtml: "" }).success,
    false,
  );
});

test("insertKbArticleSchema: rejects body that is only HTML tags / whitespace", () => {
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, bodyHtml: "<p></p>" }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, bodyHtml: "<p>   </p>" }).success,
    false,
  );
});

test("insertKbArticleSchema: rejects bad slug", () => {
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, slug: "Bad Slug" }).success,
    false,
  );
});

test("insertKbArticleSchema: rejects oversize fields", () => {
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, slug: "a".repeat(161) }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, title: "x".repeat(201) }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, summary: "x".repeat(501) }).success,
    false,
  );
});

test("insertKbArticleSchema: rejects too many tags / oversize tag", () => {
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, tags: Array(21).fill("t") }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, tags: ["x".repeat(41)] }).success,
    false,
  );
  assert.equal(
    insertKbArticleSchema.safeParse({ ...validArticle, tags: [""] }).success,
    false,
  );
});

test("insertKbArticleSchema: defaults tags, published, sortOrder", () => {
  const r = insertKbArticleSchema.safeParse(validArticle);
  assert.equal(r.success, true);
  if (r.success) {
    assert.deepEqual(r.data.tags, []);
    assert.equal(r.data.published, true);
    assert.equal(r.data.sortOrder, 0);
  }
});

test("updateKbArticleSchema: accepts empty / partial payload", () => {
  assert.equal(updateKbArticleSchema.safeParse({}).success, true);
  assert.equal(
    updateKbArticleSchema.safeParse({ published: false }).success,
    true,
  );
});

test("updateKbArticleSchema: rejects invalid partial fields", () => {
  assert.equal(
    updateKbArticleSchema.safeParse({ slug: "Bad Slug" }).success,
    false,
  );
  assert.equal(
    updateKbArticleSchema.safeParse({ bodyHtml: "<p></p>" }).success,
    false,
  );
});

// ---------- Mocks ----------

interface MockRes {
  statusCode: number;
  body: any;
  status: (n: number) => MockRes;
  json: (b: any) => MockRes;
}
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

interface StorageState {
  createCategoryCalls: InsertKbCategory[];
  updateCategoryCalls: { id: string; data: UpdateKbCategory }[];
  createArticleCalls: (InsertKbArticle & { authorId: string | null })[];
  updateArticleCalls: { id: string; data: UpdateKbArticle }[];
}

interface MockStorageOpts {
  category?: KbCategory | null;
  article?: KbArticle | null;
  createCategoryError?: Error;
  updateCategoryError?: Error;
  createArticleError?: Error;
  updateArticleError?: Error;
}

function mockStorage(opts: MockStorageOpts = {}) {
  const category = opts.category === undefined ? SAMPLE_CATEGORY : opts.category;
  const article = opts.article === undefined ? SAMPLE_ARTICLE : opts.article;
  const state: StorageState = {
    createCategoryCalls: [],
    updateCategoryCalls: [],
    createArticleCalls: [],
    updateArticleCalls: [],
  };
  const storage: KbAdminStorage = {
    async getKbCategory() { return category ?? undefined; },
    async createKbCategory(data) {
      state.createCategoryCalls.push(data);
      if (opts.createCategoryError) throw opts.createCategoryError;
      return { ...SAMPLE_CATEGORY, ...data, description: data.description ?? null };
    },
    async updateKbCategory(id, data) {
      state.updateCategoryCalls.push({ id, data });
      if (opts.updateCategoryError) throw opts.updateCategoryError;
      if (!category) return undefined;
      return { ...category, ...data, description: data.description ?? category.description };
    },
    async getKbArticleById() { return article ?? undefined; },
    async createKbArticle(data) {
      state.createArticleCalls.push(data);
      if (opts.createArticleError) throw opts.createArticleError;
      return { ...SAMPLE_ARTICLE, ...data };
    },
    async updateKbArticle(id, data) {
      state.updateArticleCalls.push({ id, data });
      if (opts.updateArticleError) throw opts.updateArticleError;
      if (!article) return undefined;
      return { ...article, ...data } as KbArticle;
    },
  };
  const activity: { args: any[] }[] = [];
  const logActivity: LogActivityFn = (...args) => {
    activity.push({ args });
  };
  const sanitizeCalls: string[] = [];
  const sanitizeHtml = (html: string) => {
    sanitizeCalls.push(html);
    return `[clean]${html}`;
  };
  return { storage, state, activity, sanitizeHtml, sanitizeCalls };
}

function makeReq(body: any, id = "cat-1"): any {
  return { body, params: { id }, session: { userId: "admin-1" } };
}

// ---------- Handler: KB category POST ----------

test("POST kb category: 400 on invalid payload", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postCategory(makeReq({ slug: "Bad Slug", name: "X" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid category");
  assert.equal(m.state.createCategoryCalls.length, 0);
});

test("POST kb category: 200 persists clean payload and logs activity", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: (...a) => m.activity.push({ args: a }), sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postCategory(
    makeReq({ slug: "billing", name: "Billing", description: "Bills" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(m.state.createCategoryCalls.length, 1);
  assert.equal(m.state.createCategoryCalls[0].slug, "billing");
  assert.equal(m.state.createCategoryCalls[0].name, "Billing");
  assert.equal(m.state.createCategoryCalls[0].description, "Bills");
  assert.equal(m.activity.length, 1);
  assert.equal(m.activity[0].args[1], "kb_category_created");
});

test("POST kb category: strips unknown fields", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postCategory(
    makeReq({ slug: "ok", name: "X", evil: "y", id: "spoofed" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const persisted = m.state.createCategoryCalls[0] as any;
  assert.equal(persisted.evil, undefined);
  assert.equal(persisted.id, undefined);
});

test("POST kb category: 409 on duplicate slug", async () => {
  const m = mockStorage({ createCategoryError: new Error('duplicate key value violates unique constraint "kb_categories_slug_key"') });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postCategory(makeReq({ slug: "ok", name: "X" }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, "Slug already in use");
});

test("POST kb category: 500 on other storage errors", async () => {
  const m = mockStorage({ createCategoryError: new Error("db down") });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postCategory(makeReq({ slug: "ok", name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

// ---------- Handler: KB category PATCH ----------

test("PATCH kb category: 400 on invalid slug", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchCategory(makeReq({ slug: "Bad Slug" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(m.state.updateCategoryCalls.length, 0);
});

test("PATCH kb category: 200 persists partial patch", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: (...a) => m.activity.push({ args: a }), sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchCategory(makeReq({ name: "Renamed" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(m.state.updateCategoryCalls.length, 1);
  assert.deepEqual(m.state.updateCategoryCalls[0], { id: "cat-1", data: { name: "Renamed" } });
  assert.equal(m.activity[0].args[1], "kb_category_updated");
});

test("PATCH kb category: 404 when missing", async () => {
  const m = mockStorage({ category: null });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchCategory(makeReq({ name: "Renamed" }, "missing"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Category not found");
});

test("PATCH kb category: 409 on duplicate slug", async () => {
  const m = mockStorage({ updateCategoryError: new Error("duplicate key") });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchCategory(makeReq({ slug: "taken" }), res);
  assert.equal(res.statusCode, 409);
});

// ---------- Handler: KB article POST ----------

test("POST kb article: 400 on invalid payload", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postArticle(makeReq({ ...validArticle, bodyHtml: "<p></p>" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid article");
  assert.equal(m.state.createArticleCalls.length, 0);
});

test("POST kb article: 400 when category not found", async () => {
  const m = mockStorage({ category: null });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postArticle(makeReq(validArticle), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Category not found");
  assert.equal(m.state.createArticleCalls.length, 0);
});

test("POST kb article: persists sanitized bodyHtml + authorId + logs activity", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: (...a) => m.activity.push({ args: a }), sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postArticle(
    makeReq({ ...validArticle, bodyHtml: "<p>Hi <script>x</script></p>" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(m.state.createArticleCalls.length, 1);
  const persisted = m.state.createArticleCalls[0];
  assert.equal(persisted.bodyHtml, "[clean]<p>Hi <script>x</script></p>");
  assert.equal(persisted.authorId, "admin-1");
  assert.equal(persisted.categoryId, "cat-1");
  assert.equal(persisted.slug, "how-to-pay");
  assert.equal(m.sanitizeCalls.length, 1);
  assert.equal(m.activity[0].args[1], "kb_article_created");
});

test("POST kb article: 409 on duplicate slug", async () => {
  const m = mockStorage({ createArticleError: new Error("duplicate key") });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postArticle(makeReq(validArticle), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.message, "Slug already in use");
});

test("POST kb article: strips unknown fields including counts", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.postArticle(
    makeReq({ ...validArticle, helpfulCount: 9999, viewCount: 42, evil: "x" }),
    res,
  );
  assert.equal(res.statusCode, 200);
  const persisted = m.state.createArticleCalls[0] as any;
  assert.equal(persisted.helpfulCount, undefined);
  assert.equal(persisted.viewCount, undefined);
  assert.equal(persisted.evil, undefined);
});

// ---------- Handler: KB article PATCH ----------

test("PATCH kb article: 400 on invalid payload", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ slug: "Bad Slug" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid article");
  assert.equal(m.state.updateArticleCalls.length, 0);
});

test("PATCH kb article: 400 when reassigning to missing category", async () => {
  const m = mockStorage({ category: null });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ categoryId: "missing" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Category not found");
  assert.equal(m.state.updateArticleCalls.length, 0);
});

test("PATCH kb article: skips category check when categoryId not in patch", async () => {
  const m = mockStorage({ category: null });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ title: "New title" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(m.state.updateArticleCalls[0].data, { title: "New title" });
});

test("PATCH kb article: sanitizes bodyHtml when provided", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: (...a) => m.activity.push({ args: a }), sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ bodyHtml: "<p>x</p>" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(m.state.updateArticleCalls.length, 1);
  assert.equal(m.state.updateArticleCalls[0].data.bodyHtml, "[clean]<p>x</p>");
  assert.equal(m.sanitizeCalls.length, 1);
  assert.equal(m.activity[0].args[1], "kb_article_updated");
});

test("PATCH kb article: omits bodyHtml from sanitize when not provided", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ published: false }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(m.state.updateArticleCalls[0].data, { published: false });
  assert.equal(m.sanitizeCalls.length, 0);
});

test("PATCH kb article: 404 when article missing", async () => {
  const m = mockStorage({ article: null });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ title: "X" }, "missing"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Article not found");
});

test("PATCH kb article: 409 on duplicate slug from storage", async () => {
  const m = mockStorage({ updateArticleError: new Error("duplicate key") });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ slug: "taken" }), res);
  assert.equal(res.statusCode, 409);
});

test("PATCH kb article: 500 on other storage errors", async () => {
  const m = mockStorage({ updateArticleError: new Error("db down") });
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ title: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

test("PATCH kb article: strips unknown fields", async () => {
  const m = mockStorage();
  const h = createKbAdminHandlers({ storage: m.storage, logActivity: () => {}, sanitizeHtml: m.sanitizeHtml });
  const res = mockRes();
  await h.patchArticle(makeReq({ title: "X", helpfulCount: 9999, evil: "y" }), res);
  assert.equal(res.statusCode, 200);
  const persisted = m.state.updateArticleCalls[0].data as any;
  assert.equal(persisted.helpfulCount, undefined);
  assert.equal(persisted.evil, undefined);
  assert.equal(persisted.title, "X");
});
