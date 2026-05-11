import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createQuickResponseHandlers,
  type QuickResponseStorage,
} from "./quick-responses";
import type {
  QuickResponse,
  InsertQuickResponse,
  QuickResponseCategory,
  InsertQuickResponseCategory,
} from "../shared/schema";

interface MockRes {
  statusCode: number;
  body: any;
  status: (n: number) => MockRes;
  json: (b: any) => MockRes;
}
function mockRes(): MockRes {
  const r: MockRes = {
    statusCode: 200,
    body: undefined,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  return r;
}

function makeReq(opts: { body?: any; params?: any; userId?: string | null } = {}): any {
  return {
    body: opts.body ?? {},
    params: opts.params ?? {},
    session: opts.userId === undefined ? { userId: "admin-1" } : { userId: opts.userId },
  };
}

function newQR(overrides: Partial<QuickResponse> = {}): QuickResponse {
  return {
    id: "qr-1",
    title: "T",
    message: "M",
    categoryId: null,
    usageCount: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as QuickResponse;
}

function newCat(overrides: Partial<QuickResponseCategory> = {}): QuickResponseCategory {
  return {
    id: "cat-1",
    name: "Billing",
    sortOrder: 0,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    ...overrides,
  } as QuickResponseCategory;
}

function buildStorage(initial: { responses?: QuickResponse[]; categories?: QuickResponseCategory[] } = {}) {
  const responses = new Map<string, QuickResponse>();
  (initial.responses ?? []).forEach((qr) => responses.set(qr.id, { ...qr }));
  const categories = new Map<string, QuickResponseCategory>();
  (initial.categories ?? []).forEach((c) => categories.set(c.id, { ...c }));
  // adminId -> Set<responseId>
  const favorites = new Map<string, Set<string>>();

  const calls = {
    createResponse: [] as InsertQuickResponse[],
    updateResponse: [] as { id: string; data: Partial<QuickResponse> }[],
    deleteResponse: [] as string[],
    bump: [] as string[],
    createCategory: [] as InsertQuickResponseCategory[],
    updateCategory: [] as { id: string; data: Partial<QuickResponseCategory> }[],
    deleteCategory: [] as string[],
    reorder: [] as string[][],
    addFav: [] as { admin: string; resp: string }[],
    removeFav: [] as { admin: string; resp: string }[],
  };

  let nextId = 1;
  const storage: QuickResponseStorage = {
    async getQuickResponse(id) { return responses.get(id); },
    async createQuickResponse(qr) {
      calls.createResponse.push(qr);
      const created = newQR({ id: `qr-new-${nextId++}`, ...qr, categoryId: qr.categoryId ?? null, usageCount: 0 });
      responses.set(created.id, created);
      return created;
    },
    async updateQuickResponse(id, data) {
      calls.updateResponse.push({ id, data });
      const cur = responses.get(id);
      if (!cur) return undefined;
      const merged = { ...cur, ...data };
      responses.set(id, merged);
      return merged;
    },
    async deleteQuickResponse(id) {
      calls.deleteResponse.push(id);
      responses.delete(id);
      // mimic real impl: clean favorites
      for (const set of favorites.values()) set.delete(id);
    },
    async bumpQuickResponseUsage(id) {
      calls.bump.push(id);
      const cur = responses.get(id);
      if (!cur) return undefined;
      const updated = { ...cur, usageCount: cur.usageCount + 1 };
      responses.set(id, updated);
      return updated;
    },
    async getAllQuickResponseCategories() {
      return Array.from(categories.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async getQuickResponseCategory(id) { return categories.get(id); },
    async createQuickResponseCategory(data) {
      calls.createCategory.push(data);
      const created = newCat({ id: `cat-new-${nextId++}`, ...data });
      categories.set(created.id, created);
      return created;
    },
    async updateQuickResponseCategory(id, data) {
      calls.updateCategory.push({ id, data });
      const cur = categories.get(id);
      if (!cur) return undefined;
      const merged = { ...cur, ...data };
      categories.set(id, merged);
      return merged;
    },
    async deleteQuickResponseCategory(id) {
      calls.deleteCategory.push(id);
      categories.delete(id);
      for (const qr of responses.values()) {
        if (qr.categoryId === id) responses.set(qr.id, { ...qr, categoryId: null });
      }
    },
    async reorderQuickResponseCategories(ids) {
      calls.reorder.push([...ids]);
      ids.forEach((id, idx) => {
        const cur = categories.get(id);
        if (cur) categories.set(id, { ...cur, sortOrder: idx });
      });
    },
    async getQuickResponseFavoriteIds(adminId) {
      return Array.from(favorites.get(adminId) ?? []);
    },
    async addQuickResponseFavorite(adminId, responseId) {
      calls.addFav.push({ admin: adminId, resp: responseId });
      let set = favorites.get(adminId);
      if (!set) { set = new Set(); favorites.set(adminId, set); }
      set.add(responseId);
    },
    async removeQuickResponseFavorite(adminId, responseId) {
      calls.removeFav.push({ admin: adminId, resp: responseId });
      favorites.get(adminId)?.delete(responseId);
    },
  };

  return { storage, calls, responses, categories, favorites };
}

// ---------- create ----------

test("create: 400 when title or message missing", async () => {
  const { storage, calls } = buildStorage();
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.create(makeReq({ body: { title: "", message: "x" } }), res);
  assert.equal(res.statusCode, 400);
  await h.create(makeReq({ body: { title: "x", message: "" } }), res);
  assert.equal(res.statusCode, 400);
  await h.create(makeReq({ body: {} }), mockRes());
  assert.equal(calls.createResponse.length, 0);
});

test("create: persists with null categoryId when omitted or blank", async () => {
  const { storage, calls } = buildStorage();
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.create(makeReq({ body: { title: "T", message: "M" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.createResponse[0].categoryId, null);

  const res2 = mockRes();
  await h.create(makeReq({ body: { title: "T", message: "M", categoryId: "  " } }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(calls.createResponse[1].categoryId, null);
});

test("create: 400 when categoryId references unknown category", async () => {
  const { storage, calls } = buildStorage();
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.create(makeReq({ body: { title: "T", message: "M", categoryId: "missing" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Unknown category");
  assert.equal(calls.createResponse.length, 0);
});

test("create: persists when categoryId is valid", async () => {
  const cat = newCat({ id: "c1" });
  const { storage, calls } = buildStorage({ categories: [cat] });
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.create(makeReq({ body: { title: "T", message: "M", categoryId: "c1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.createResponse[0].categoryId, "c1");
});

// ---------- update ----------

test("update: omits unspecified fields, allows clearing categoryId with null", async () => {
  const cat = newCat({ id: "c1" });
  const qr = newQR({ id: "qr-1", categoryId: "c1" });
  const { storage, calls } = buildStorage({ responses: [qr], categories: [cat] });
  const h = createQuickResponseHandlers({ storage });

  const res = mockRes();
  await h.update(makeReq({ params: { id: "qr-1" }, body: { title: "New" } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(calls.updateResponse[0].data).sort(), ["title"]);

  const res2 = mockRes();
  await h.update(makeReq({ params: { id: "qr-1" }, body: { categoryId: null } }), res2);
  assert.equal(res2.statusCode, 200);
  assert.equal(calls.updateResponse[1].data.categoryId, null);
});

test("update: 400 on unknown categoryId", async () => {
  const qr = newQR({ id: "qr-1" });
  const { storage } = buildStorage({ responses: [qr] });
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.update(makeReq({ params: { id: "qr-1" }, body: { categoryId: "ghost" } }), res);
  assert.equal(res.statusCode, 400);
});

test("update: 404 when response not found", async () => {
  const { storage } = buildStorage();
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.update(makeReq({ params: { id: "missing" }, body: { title: "X" } }), res);
  assert.equal(res.statusCode, 404);
});

// ---------- delete + favorites cleanup ----------

test("delete: removes the response and clears it from favorites", async () => {
  const qr = newQR({ id: "qr-1" });
  const { storage, responses, favorites } = buildStorage({ responses: [qr] });
  const h = createQuickResponseHandlers({ storage });

  await h.addFavorite(makeReq({ params: { id: "qr-1" }, userId: "admin-1" }), mockRes());
  assert.deepEqual(Array.from(favorites.get("admin-1") ?? []), ["qr-1"]);

  const res = mockRes();
  await h.remove(makeReq({ params: { id: "qr-1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(responses.has("qr-1"), false);
  assert.deepEqual(Array.from(favorites.get("admin-1") ?? []), []);
});

// ---------- bump usage ----------

test("bumpUsage: increments usage_count and returns updated row", async () => {
  const qr = newQR({ id: "qr-1", usageCount: 4 });
  const { storage, calls, responses } = buildStorage({ responses: [qr] });
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.bumpUsage(makeReq({ params: { id: "qr-1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.usageCount, 5);
  assert.equal(responses.get("qr-1")?.usageCount, 5);
  assert.deepEqual(calls.bump, ["qr-1"]);
});

test("bumpUsage: 404 when response missing", async () => {
  const { storage } = buildStorage();
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.bumpUsage(makeReq({ params: { id: "nope" } }), res);
  assert.equal(res.statusCode, 404);
});

// ---------- categories ----------

test("createCategory: 400 on blank name; assigns sortOrder=existingCount", async () => {
  const { storage, calls } = buildStorage({ categories: [newCat({ id: "c1" }), newCat({ id: "c2" })] });
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.createCategory(makeReq({ body: { name: "  " } }), res);
  assert.equal(res.statusCode, 400);

  const res2 = mockRes();
  await h.createCategory(makeReq({ body: { name: "  Refunds  " } }), res2);
  assert.equal(res2.statusCode, 200);
  assert.deepEqual(calls.createCategory[0], { name: "Refunds", sortOrder: 2 });
});

test("updateCategory: 400 on blank name; trims valid name", async () => {
  const { storage, calls } = buildStorage({ categories: [newCat({ id: "c1" })] });
  const h = createQuickResponseHandlers({ storage });
  await h.updateCategory(makeReq({ params: { id: "c1" }, body: { name: "  " } }), mockRes());
  assert.equal(calls.updateCategory.length, 0);

  const res = mockRes();
  await h.updateCategory(makeReq({ params: { id: "c1" }, body: { name: "  X  " } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.updateCategory[0].data, { name: "X" });
});

test("removeCategory: demotes its responses to uncategorized", async () => {
  const cat = newCat({ id: "c1" });
  const qr = newQR({ id: "qr-1", categoryId: "c1" });
  const { storage, responses } = buildStorage({ responses: [qr], categories: [cat] });
  const h = createQuickResponseHandlers({ storage });
  const res = mockRes();
  await h.removeCategory(makeReq({ params: { id: "c1" } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(responses.get("qr-1")?.categoryId, null);
});

test("reorderCategories: 400 on bad payload; persists order on valid payload", async () => {
  const cats = [newCat({ id: "c1", sortOrder: 0 }), newCat({ id: "c2", sortOrder: 1 }), newCat({ id: "c3", sortOrder: 2 })];
  const { storage, categories, calls } = buildStorage({ categories: cats });
  const h = createQuickResponseHandlers({ storage });

  await h.reorderCategories(makeReq({ body: { orderedIds: "nope" } }), mockRes());
  await h.reorderCategories(makeReq({ body: { orderedIds: [1, 2] } }), mockRes());
  assert.equal(calls.reorder.length, 0);

  const res = mockRes();
  await h.reorderCategories(makeReq({ body: { orderedIds: ["c3", "c1", "c2"] } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(categories.get("c3")?.sortOrder, 0);
  assert.equal(categories.get("c1")?.sortOrder, 1);
  assert.equal(categories.get("c2")?.sortOrder, 2);
});

// ---------- favorites + per-admin scoping ----------

test("favorites: scoped per admin; another admin's favorites are not exposed", async () => {
  const qr = newQR({ id: "qr-1" });
  const { storage } = buildStorage({ responses: [qr] });
  const h = createQuickResponseHandlers({ storage });

  await h.addFavorite(makeReq({ params: { id: "qr-1" }, userId: "admin-A" }), mockRes());

  const resA = mockRes();
  await h.listFavorites(makeReq({ userId: "admin-A" }), resA);
  assert.deepEqual(resA.body, ["qr-1"]);

  const resB = mockRes();
  await h.listFavorites(makeReq({ userId: "admin-B" }), resB);
  assert.deepEqual(resB.body, []);
});

test("favorites: 401 when no session userId (authz boundary)", async () => {
  const { storage } = buildStorage({ responses: [newQR({ id: "qr-1" })] });
  const h = createQuickResponseHandlers({ storage });
  const r1 = mockRes(); await h.listFavorites(makeReq({ userId: null }), r1);
  assert.equal(r1.statusCode, 401);
  const r2 = mockRes(); await h.addFavorite(makeReq({ params: { id: "qr-1" }, userId: null }), r2);
  assert.equal(r2.statusCode, 401);
  const r3 = mockRes(); await h.removeFavorite(makeReq({ params: { id: "qr-1" }, userId: null }), r3);
  assert.equal(r3.statusCode, 401);
});

test("favorites: addFavorite 404 when response missing; remove always succeeds", async () => {
  const { storage, calls } = buildStorage();
  const h = createQuickResponseHandlers({ storage });

  const r = mockRes();
  await h.addFavorite(makeReq({ params: { id: "missing" } }), r);
  assert.equal(r.statusCode, 404);
  assert.equal(calls.addFav.length, 0);

  const r2 = mockRes();
  await h.removeFavorite(makeReq({ params: { id: "anything" } }), r2);
  assert.equal(r2.statusCode, 200);
});

test("favorites: removing leaves only the targeted response unfavorited", async () => {
  const { storage, favorites } = buildStorage({
    responses: [newQR({ id: "qr-1" }), newQR({ id: "qr-2" })],
  });
  const h = createQuickResponseHandlers({ storage });
  await h.addFavorite(makeReq({ params: { id: "qr-1" } }), mockRes());
  await h.addFavorite(makeReq({ params: { id: "qr-2" } }), mockRes());
  await h.removeFavorite(makeReq({ params: { id: "qr-1" } }), mockRes());
  assert.deepEqual(Array.from(favorites.get("admin-1") ?? []).sort(), ["qr-2"]);
});
