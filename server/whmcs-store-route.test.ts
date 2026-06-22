import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";
import {
  createListStoreProductsHandler,
  createPlaceProductOrderHandler,
  validateStoreOrderInputs,
  createCreateStoreProductHandler,
  createUpdateStoreProductHandler,
  createDeleteStoreProductHandler,
  createReorderStoreProductsHandler,
  parseRemoveImageUrls,
  STORE_PRODUCT_MAX_GALLERY_IMAGES,
  type StoreRouteDeps,
  type AdminStoreRouteDeps,
} from "./whmcs-store-route";
import type { StoreCatalogueData, StoreCatalogueProduct, PaymentMethodsData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";
import type { StoreProduct } from "@shared/schema";

// Route-level + pure-validator tests for the customer storefront endpoints:
//   GET  /api/billing/store-products
//   POST /api/billing/store-order
//
// These exercise the PRODUCTION handler factories (wired into routes.ts) with
// the catalogue loader / payment-method loader / AddOrder writer injected so no
// live WHMCS is touched. Contracts mirror the in-app ordering route:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user only;
//      unlinked staff are blocked.
//   2. Validity — the product, cycle, config options and custom fields are all
//      validated against the live curated catalogue before any write.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the new invoice id + pay URL are returned and the validated
//      option/custom maps are forwarded to AddOrder.

function catalogueProduct(over: Partial<StoreCatalogueProduct> = {}): StoreCatalogueProduct {
  return {
    pid: 10,
    name: "Starter VPS",
    description: "",
    imageUrl: null,
    images: [],
    category: "Hosting",
    sortOrder: 0,
    currency: "USD",
    cycles: [
      { cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null },
      { cycle: "annually", label: "Annually", price: "100.00", setupFee: null },
    ],
    configOptions: [],
    customFields: [],
    ...over,
  };
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  catalogue?: StoreCatalogueData;
  loadPaymentMethods?: StoreRouteDeps["loadPaymentMethods"];
  addOrder?: StoreRouteDeps["addOrder"];
  recordPendingOrder?: StoreRouteDeps["recordPendingOrder"];
}

function okMethods(): StoreRouteDeps["loadPaymentMethods"] {
  return async (): Promise<PaymentMethodsData> => ({ methods: [{ module: "stripe", displayName: "Stripe" }], unreachable: false });
}

function makeDeps(opts: AppOpts): StoreRouteDeps {
  return {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadStoreCatalogue: async () => opts.catalogue ?? { products: [catalogueProduct()], unreachable: false },
    loadPaymentMethods: opts.loadPaymentMethods ?? okMethods(),
    addOrder: opts.addOrder,
    recordPendingOrder: opts.recordPendingOrder,
  };
}

function makeApp(opts: AppOpts) {
  const deps = makeDeps(opts);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/billing/store-products", createListStoreProductsHandler(deps));
  app.post("/api/billing/store-order", createPlaceProductOrderHandler(deps));
  return app;
}

async function get(app: express.Express, path: string) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

async function post(app: express.Express, path: string, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

// ---- validateStoreOrderInputs (pure) ----

test("validateStoreOrderInputs: rejects missing required dropdown", () => {
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const r = validateStoreOrderInputs(product, {}, {});
  assert.equal(r.ok, false);
});

test("validateStoreOrderInputs: rejects an invalid dropdown choice", () => {
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const r = validateStoreOrderInputs(product, { "5": 999 }, {});
  assert.equal(r.ok, false);
});

test("validateStoreOrderInputs: accepts valid choice + drops zero-quantity", () => {
  const product = catalogueProduct({
    configOptions: [
      { id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] },
      { id: 6, name: "Extra IPs", type: "quantity", required: false, choices: [] },
    ],
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const r = validateStoreOrderInputs(product, { "5": 51, "6": 0 }, { "1": "host.example.com" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.configOptions, { 5: 51 });
    assert.deepEqual(r.customFields, { 1: "host.example.com" });
  }
});

test("validateStoreOrderInputs: rejects missing required custom field", () => {
  const product = catalogueProduct({
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const r = validateStoreOrderInputs(product, {}, {});
  assert.equal(r.ok, false);
});

// ---- GET /api/billing/store-products ----

test("GET store-products: unconfigured returns configured:false, never 500", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 1 } }, hasCredentials: false });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.equal(body.configured, false);
  assert.deepEqual(body.products, []);
});

test("GET store-products: linked customer gets the catalogue + gateway flag", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 1 } } });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.linked, true);
  assert.equal(body.hasGateway, true);
  assert.equal(body.products.length, 1);
});

test("GET store-products: unreachable WHMCS yields empty (never 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 1 } },
    catalogue: { products: [], unreachable: true },
  });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.deepEqual(body.products, []);
});

test("GET store-products: unlinked staff are blocked", async () => {
  const app = makeApp({ sessionUserId: "s1", users: { s1: { whmcsClientId: null, role: "admin" } } });
  const { status } = await get(app, "/api/billing/store-products");
  assert.equal(status, 403);
});

// ---- POST /api/billing/store-order ----

test("POST store-order: places the order and forwards validated config/custom maps", async () => {
  let captured: any = null;
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (input): Promise<WhmcsRawFetch> => {
      captured = input;
      return { ok: true, data: { invoiceid: 777 } };
    },
  });
  const { status, body } = await post(app, "/api/billing/store-order", {
    pid: 10,
    billingCycle: "monthly",
    configOptions: { "5": 51 },
    customFields: { "1": "host.example.com" },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invoiceId, 777);
  assert.equal(captured.clientId, 42);
  assert.deepEqual(captured.configOptions, { 5: 51 });
  assert.deepEqual(captured.customFields, { 1: "host.example.com" });
});

test("POST store-order: a one-time product order forwards billingCycle 'onetime' unchanged", async () => {
  let captured: any = null;
  const product = catalogueProduct({
    pid: 20,
    name: "Setup Fee",
    cycles: [{ cycle: "onetime", label: "One-time", price: "25.00", setupFee: null }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (input): Promise<WhmcsRawFetch> => {
      captured = input;
      return { ok: true, data: { invoiceid: 778 } };
    },
  });
  const { status, body } = await post(app, "/api/billing/store-order", { pid: 20, billingCycle: "onetime" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(captured.billingCycle, "onetime");
});

test("POST store-order: a 'monthly' cycle on a one-time-only product is rejected 404", async () => {
  // Defence: the widened storefront enum must not let a customer pick a cycle the
  // product doesn't actually offer.
  const product = catalogueProduct({
    pid: 20,
    cycles: [{ cycle: "onetime", label: "One-time", price: "25.00", setupFee: null }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (): Promise<WhmcsRawFetch> => {
      throw new Error("must not write");
    },
  });
  const { status } = await post(app, "/api/billing/store-order", { pid: 20, billingCycle: "monthly" });
  assert.equal(status, 404);
});

test("POST store-order: unknown product/cycle is 404", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 42 } } });
  const { status } = await post(app, "/api/billing/store-order", { pid: 999, billingCycle: "monthly" });
  assert.equal(status, 404);
});

test("POST store-order: missing required option is 400 and never writes", async () => {
  let wrote = false;
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (): Promise<WhmcsRawFetch> => {
      wrote = true;
      return { ok: true, data: {} };
    },
  });
  const { status } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.equal(wrote, false);
});

test("POST store-order: unlinked customer is 409", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } } });
  const { status } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 409);
});

test("POST store-order: WHMCS rejection surfaces as 400", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "nope" }),
  });
  const { status, body } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});

// ============================================================================
// Admin store-product gallery management (Task #534)
//   POST   /api/admin/store-products
//   PATCH  /api/admin/store-products/:id
//   DELETE /api/admin/store-products/:id
//
// These exercise the PRODUCTION admin handler factories (wired into routes.ts)
// with the storage layer, the upload writer (`saveUploadedFile`), and the
// orphan-cleanup helper (`deleteUploadedFileIfUnreferenced`) injected — no live
// DB, WHMCS, or multer needed. The gallery contract under test:
//   1. multiple `images` uploads persist into `image_urls`;
//   2. `removeImageUrls` drops exactly the right entries + cleans only departing
//      blobs;
//   3. the 8-image cap (STORE_PRODUCT_MAX_GALLERY_IMAGES) is enforced by the
//      `images`-field multer maxCount;
//   4. gallery blobs are cleaned up on delete and rolled back on a save failure.
// ============================================================================

function storeProduct(over: Partial<StoreProduct> = {}): StoreProduct {
  return {
    id: "sp1",
    whmcsProductId: 10,
    name: "Starter VPS",
    description: null,
    imageUrl: null,
    imageUrls: [],
    category: null,
    sortOrder: 0,
    enabled: true,
    createdAt: new Date(),
    ...over,
  };
}

// A tiny in-memory harness: each saved upload returns a deterministic
// `/uploads/<originalname>` path, and every cleanup call is recorded so a test
// can assert exactly which blobs were removed.
interface AdminHarness {
  deps: AdminStoreRouteDeps;
  saved: string[];
  removed: string[];
  referenced: Set<string>;
  lastCreate?: any;
  lastUpdate?: { id: string; data: any };
  lastReorder?: string[];
}

function makeAdminDeps(over: Partial<AdminStoreRouteDeps> & { existing?: StoreProduct } = {}): AdminHarness {
  const saved: string[] = [];
  const removed: string[] = [];
  const referenced = new Set<string>();
  const harness: AdminHarness = { saved, removed, referenced, deps: {} as AdminStoreRouteDeps };
  harness.deps = {
    listStoreProducts: async () => (over.existing ? [over.existing] : []),
    getStoreProductByPid: async () => undefined,
    getStoreProduct: async (id) => (over.existing && over.existing.id === id ? over.existing : undefined),
    createStoreProduct: async (data) => {
      harness.lastCreate = data;
      return storeProduct({ ...data, id: "new" } as Partial<StoreProduct>);
    },
    updateStoreProduct: async (id, data) => {
      harness.lastUpdate = { id, data };
      const base = over.existing ?? storeProduct({ id });
      return storeProduct({ ...base, ...data, id });
    },
    deleteStoreProduct: async (id) => (over.existing && over.existing.id === id ? over.existing : undefined),
    reorderStoreProducts: async (orderedIds) => {
      harness.lastReorder = orderedIds;
    },
    saveUploadedFile: async (file) => {
      const url = `/uploads/${file.originalname}`;
      saved.push(url);
      return url;
    },
    deleteUploadedFileIfUnreferenced: async (url) => {
      if (!url) return;
      // Mirror production: only remove a blob nothing references anymore.
      if (referenced.has(url)) return;
      removed.push(url);
    },
    logActivity: () => {},
    getErrorMessage: (e) => (e instanceof Error ? e.message : String(e)),
    ...over,
  };
  return harness;
}

// Drives a factory handler with the given body + injected gallery files (the
// shape multer's `upload.fields` produces on req.files), returning the captured
// res status + JSON body. No HTTP / multipart needed — the factory reads exactly
// these two seams.
async function callAdmin(
  handler: (req: any, res: any) => Promise<unknown>,
  opts: { body?: any; params?: any; gallery?: string[]; primary?: string },
): Promise<{ status: number; body: any }> {
  const files: Record<string, any[]> = {};
  if (opts.primary) files.image = [{ originalname: opts.primary, mimetype: "image/png", buffer: Buffer.from("x") }];
  if (opts.gallery) files.images = opts.gallery.map((n) => ({ originalname: n, mimetype: "image/png", buffer: Buffer.from("x") }));
  let status = 200;
  let json: any;
  const res: any = {
    status(code: number) { status = code; return this; },
    json(payload: any) { json = payload; return this; },
  };
  const req: any = {
    body: opts.body ?? {},
    params: opts.params ?? {},
    files: Object.keys(files).length ? files : undefined,
    session: { userId: "admin1" },
  };
  await handler(req, res);
  return { status, body: json };
}

// ---- parseRemoveImageUrls (pure) ----

test("parseRemoveImageUrls: parses a JSON string array, drops non-strings", () => {
  assert.deepEqual(parseRemoveImageUrls('["/uploads/a.png","/uploads/b.png"]'), ["/uploads/a.png", "/uploads/b.png"]);
  assert.deepEqual(parseRemoveImageUrls('["/uploads/a.png", 5, null]'), ["/uploads/a.png"]);
});

test("parseRemoveImageUrls: malformed / empty / non-array degrade to []", () => {
  assert.deepEqual(parseRemoveImageUrls(""), []);
  assert.deepEqual(parseRemoveImageUrls("not json"), []);
  assert.deepEqual(parseRemoveImageUrls('{"a":1}'), []);
  assert.deepEqual(parseRemoveImageUrls(undefined), []);
});

// ---- POST /api/admin/store-products ----

test("POST admin store-product: multiple gallery uploads persist into image_urls", async () => {
  const h = makeAdminDeps();
  const { status, body } = await callAdmin(createCreateStoreProductHandler(h.deps), {
    body: { whmcsProductId: "10", name: "VPS" },
    gallery: ["g1.png", "g2.png", "g3.png"],
  });
  assert.equal(status, 200);
  assert.deepEqual(body.product.imageUrls, ["/uploads/g1.png", "/uploads/g2.png", "/uploads/g3.png"]);
  assert.deepEqual(h.lastCreate.imageUrls, ["/uploads/g1.png", "/uploads/g2.png", "/uploads/g3.png"]);
  assert.equal(h.removed.length, 0);
});

test("POST admin store-product: a failed insert rolls back every just-saved blob", async () => {
  const h = makeAdminDeps({
    createStoreProduct: async () => { throw new Error("unique pid race"); },
  });
  const { status } = await callAdmin(createCreateStoreProductHandler(h.deps), {
    body: { whmcsProductId: "10" },
    primary: "p.png",
    gallery: ["g1.png", "g2.png"],
  });
  assert.equal(status, 500);
  // The primary + both gallery blobs were persisted before the row insert, so a
  // failure must remove all three — nothing references them yet.
  assert.deepEqual(h.removed.sort(), ["/uploads/g1.png", "/uploads/g2.png", "/uploads/p.png"]);
});

test("POST admin store-product: a bad pid is 400 and saves no blobs", async () => {
  const h = makeAdminDeps();
  const { status } = await callAdmin(createCreateStoreProductHandler(h.deps), {
    body: { whmcsProductId: "0" },
    gallery: ["g1.png"],
  });
  assert.equal(status, 400);
  assert.equal(h.saved.length, 0);
});

// ---- PATCH /api/admin/store-products/:id ----

test("PATCH admin store-product: removeImageUrls drops the right blobs and appends new uploads", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrls: ["/uploads/keep.png", "/uploads/drop.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { removeImageUrls: JSON.stringify(["/uploads/drop.png"]) },
    gallery: ["new.png"],
  });
  assert.equal(status, 200);
  // kept = existing minus removed, then new uploads appended.
  assert.deepEqual(body.product.imageUrls, ["/uploads/keep.png", "/uploads/new.png"]);
  assert.deepEqual(h.lastUpdate!.data.imageUrls, ["/uploads/keep.png", "/uploads/new.png"]);
  // Only the dropped blob leaves the row → only it is cleaned up.
  assert.deepEqual(h.removed, ["/uploads/drop.png"]);
});

test("PATCH admin store-product: a removeImageUrls entry not on the row is ignored (no cleanup)", async () => {
  const existing = storeProduct({ id: "sp1", imageUrls: ["/uploads/a.png"] });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { removeImageUrls: JSON.stringify(["/uploads/not-here.png"]) },
  });
  assert.equal(status, 200);
  assert.deepEqual(body.product.imageUrls, ["/uploads/a.png"]);
  assert.equal(h.removed.length, 0);
});

test("PATCH admin store-product: a failed update rolls back ONLY the new blobs, leaving old ones referenced", async () => {
  const existing = storeProduct({ id: "sp1", imageUrls: ["/uploads/old.png"] });
  const h = makeAdminDeps({
    existing,
    updateStoreProduct: async () => { throw new Error("db down"); },
  });
  const { status } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { removeImageUrls: JSON.stringify(["/uploads/old.png"]) },
    gallery: ["fresh.png"],
  });
  assert.equal(status, 500);
  // The just-saved gallery blob is rolled back; the old blob is untouched (the
  // row update never landed, so it's still referenced).
  assert.deepEqual(h.removed, ["/uploads/fresh.png"]);
});

test("PATCH admin store-product: promotePrimaryImageUrl swaps a gallery image into primary and demotes the old primary", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: "/uploads/old-primary.png",
    imageUrls: ["/uploads/g1.png", "/uploads/g2.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { promotePrimaryImageUrl: "/uploads/g2.png" },
  });
  assert.equal(status, 200);
  // Promoted gallery image becomes primary; old primary moves to the head of
  // the gallery; the promoted url leaves the gallery.
  assert.equal(body.product.imageUrl, "/uploads/g2.png");
  assert.deepEqual(body.product.imageUrls, ["/uploads/old-primary.png", "/uploads/g1.png"]);
  // No blob leaves the row — nothing is cleaned up.
  assert.equal(h.removed.length, 0);
});

test("PATCH admin store-product: promotion with no current primary just pulls the image up", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: null,
    imageUrls: ["/uploads/g1.png", "/uploads/g2.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { promotePrimaryImageUrl: "/uploads/g1.png" },
  });
  assert.equal(status, 200);
  assert.equal(body.product.imageUrl, "/uploads/g1.png");
  assert.deepEqual(body.product.imageUrls, ["/uploads/g2.png"]);
  assert.equal(h.removed.length, 0);
});

test("PATCH admin store-product: a new primary upload wins over a promotion request", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: "/uploads/old-primary.png",
    imageUrls: ["/uploads/g1.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { promotePrimaryImageUrl: "/uploads/g1.png" },
    primary: "fresh.png",
  });
  assert.equal(status, 200);
  // The uploaded file becomes primary; the gallery is untouched; the old primary
  // blob is cleaned up (replaced, not demoted).
  assert.equal(body.product.imageUrl, "/uploads/fresh.png");
  assert.deepEqual(body.product.imageUrls, ["/uploads/g1.png"]);
  assert.deepEqual(h.removed, ["/uploads/old-primary.png"]);
});

test("PATCH admin store-product: promoting an image not in the gallery is a no-op", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: "/uploads/old-primary.png",
    imageUrls: ["/uploads/g1.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: { promotePrimaryImageUrl: "/uploads/not-here.png" },
  });
  assert.equal(status, 200);
  assert.equal(body.product.imageUrl, "/uploads/old-primary.png");
  assert.deepEqual(body.product.imageUrls, ["/uploads/g1.png"]);
  assert.equal(h.removed.length, 0);
});

test("PATCH admin store-product: promotion respects a concurrent reorder of the kept gallery", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: "/uploads/old-primary.png",
    imageUrls: ["/uploads/g1.png", "/uploads/g2.png", "/uploads/g3.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "sp1" },
    body: {
      promotePrimaryImageUrl: "/uploads/g2.png",
      imageUrlsOrder: JSON.stringify(["/uploads/g3.png", "/uploads/g1.png", "/uploads/g2.png"]),
    },
  });
  assert.equal(status, 200);
  assert.equal(body.product.imageUrl, "/uploads/g2.png");
  // Reorder applies first (g3, g1, g2 minus the promoted g2), then the old
  // primary lands at the head.
  assert.deepEqual(body.product.imageUrls, ["/uploads/old-primary.png", "/uploads/g3.png", "/uploads/g1.png"]);
  assert.equal(h.removed.length, 0);
});

test("PATCH admin store-product: missing product is 404", async () => {
  const h = makeAdminDeps();
  const { status } = await callAdmin(createUpdateStoreProductHandler(h.deps), {
    params: { id: "nope" },
    body: { name: "x" },
  });
  assert.equal(status, 404);
});

// ---- DELETE /api/admin/store-products/:id ----

test("DELETE admin store-product: cleans up the primary AND every gallery blob", async () => {
  const existing = storeProduct({
    id: "sp1",
    imageUrl: "/uploads/primary.png",
    imageUrls: ["/uploads/g1.png", "/uploads/g2.png"],
  });
  const h = makeAdminDeps({ existing });
  const { status, body } = await callAdmin(createDeleteStoreProductHandler(h.deps), {
    params: { id: "sp1" },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(h.removed.sort(), ["/uploads/g1.png", "/uploads/g2.png", "/uploads/primary.png"]);
});

test("DELETE admin store-product: missing product is 404 and removes nothing", async () => {
  const h = makeAdminDeps();
  const { status } = await callAdmin(createDeleteStoreProductHandler(h.deps), {
    params: { id: "nope" },
  });
  assert.equal(status, 404);
  assert.equal(h.removed.length, 0);
});

test("POST admin store-products reorder: persists the ordered id list", async () => {
  const h = makeAdminDeps();
  const { status, body } = await callAdmin(createReorderStoreProductsHandler(h.deps), {
    body: { orderedIds: ["c", "a", "b"] },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(h.lastReorder, ["c", "a", "b"]);
});

test("POST admin store-products reorder: 400 on a non-array / non-string payload, persists nothing", async () => {
  const h1 = makeAdminDeps();
  const r1 = await callAdmin(createReorderStoreProductsHandler(h1.deps), { body: { orderedIds: "nope" } });
  assert.equal(r1.status, 400);
  assert.equal(h1.lastReorder, undefined);

  const h2 = makeAdminDeps();
  const r2 = await callAdmin(createReorderStoreProductsHandler(h2.deps), { body: { orderedIds: [1, 2] } });
  assert.equal(r2.status, 400);
  assert.equal(h2.lastReorder, undefined);
});

// ---- Gallery cap (STORE_PRODUCT_MAX_GALLERY_IMAGES) enforced by multer ----

test("gallery cap constant is 8", () => {
  assert.equal(STORE_PRODUCT_MAX_GALLERY_IMAGES, 8);
});

// Mirror the exact multer field config the admin routes wire in and assert the
// `images` field rejects the (cap + 1)th upload — this is the production cap
// mechanism (multer's per-field maxCount), keyed off the same exported constant.
function makeUploadCapApp() {
  const upload = multer({ storage: multer.memoryStorage() });
  const app = express();
  app.post(
    "/upload",
    upload.fields([
      { name: "image", maxCount: 1 },
      { name: "images", maxCount: STORE_PRODUCT_MAX_GALLERY_IMAGES },
    ]),
    (req, res) => {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
      res.json({ gallery: (files.images ?? []).length });
    },
  );
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(400).json({ code: err?.code ?? "ERR", field: err?.field });
  });
  return app;
}

async function postFiles(app: express.Express, count: number): Promise<{ status: number; body: any }> {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const form = new FormData();
    for (let i = 0; i < count; i++) {
      form.append("images", new Blob([`img-${i}`], { type: "image/png" }), `g${i}.png`);
    }
    const res = await fetch(`http://127.0.0.1:${port}/upload`, { method: "POST", body: form });
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

test("gallery cap: exactly the cap number of images is accepted", async () => {
  const app = makeUploadCapApp();
  const { status, body } = await postFiles(app, STORE_PRODUCT_MAX_GALLERY_IMAGES);
  assert.equal(status, 200);
  assert.equal(body.gallery, STORE_PRODUCT_MAX_GALLERY_IMAGES);
});

test("gallery cap: one over the cap is rejected by multer", async () => {
  const app = makeUploadCapApp();
  const { status, body } = await postFiles(app, STORE_PRODUCT_MAX_GALLERY_IMAGES + 1);
  assert.equal(status, 400);
  assert.equal(body.code, "LIMIT_UNEXPECTED_FILE");
});
