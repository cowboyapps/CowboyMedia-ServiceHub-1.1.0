import { test, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { registerTelegramImportRoutes } from "./telegram-import-routes";
import { createRequireMasterAdmin, createRequirePermission } from "./require-permission";
import type { TelegramImporter } from "./telegram-import";
import type { TelegramImportStore } from "./telegram-import-store";
import { pool } from "./db";

after(async () => { await pool.end(); });

test("Telegram routes isolate drafts and account setup and validate publication before side effects", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = { userId: req.header("x-test-user") } as typeof req.session;
    next();
  });
  let published = 0, saved = 0, notifications = 0, failNotifications = false;
  const users = {
    master: { role: "master_admin" }, customer: { role: "customer" },
    viewer: { role: "admin", adminRoleId: "viewer" }, manager: { role: "admin", adminRoleId: "manager" },
  };
  const auth = {
    getUser: async (id: string) => users[id as keyof typeof users],
    getAdminRole: async (id: string) => ({ permissions: id === "manager" ? ["service_updates.view", "service_updates.manage"] : ["service_updates.view"] }),
  };
  const store = {
    pending: async () => [{ id: "draft-one", description: "<p>Private draft</p>" }],
    getDraft: async (id: string) => id === "missing" ? undefined : ({ id, status: "pending" }),
    saveDraft: async (_id: string, data: unknown) => { saved++; return data; },
    deleteDraft: async () => { saved++; },
    publish: async () => { published++; return { created: true, id: "published-one", update: { id: "published-one" } }; },
  } as unknown as TelegramImportStore;
  const importer = {
    status: async () => ({ configured: false, connected: false }),
    channels: async () => [],
    login: async () => ({ configured: true, loginStep: "code" }),
  } as unknown as TelegramImporter;
  registerTelegramImportRoutes(app, {
    store, importer, master: createRequireMasterAdmin(auth), drafts: createRequirePermission(auth)("service_updates.view", "service_updates.manage"),
    serviceExists: async id => id === "service-one",
    published: async () => { notifications++; if (failNotifications) throw new Error("Synthetic delivery failure"); }, audit: () => {},
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const root = `http://127.0.0.1:${address.port}/api/admin/telegram-import`;
  const call = async (path: string, role?: string, method = "GET", body?: unknown) => fetch(`${root}${path}`, {
    method, headers: { ...(role ? { "x-test-user": role } : {}), "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    assert.equal((await call("/drafts")).status, 401);
    assert.equal((await call("/drafts", "customer")).status, 403);
    assert.equal((await call("/drafts", "viewer")).status, 200);
    assert.equal((await call("/status", "manager")).status, 403);
    assert.deepEqual(await (await call("/status", "master")).json(), { configured: false, connected: false });
    assert.equal((await call("/login/start", "master", "POST", { phoneNumber: "invalid" })).status, 400);
    assert.equal((await call("/drafts/one", "viewer", "PATCH", {})).status, 403);
    const fields = { title: "", description: "<p>Draft</p><script>bad()</script>", serviceId: "", matureContent: false };
    const save = await call("/drafts/one", "manager", "PATCH", fields);
    assert.equal(save.status, 200);
    assert.equal((await save.json()).description, "<p>Draft</p>");
    assert.equal(saved, 1);
    assert.equal(published, 0);
    assert.equal(notifications, 0, "saving never invokes customer notification code");
    assert.equal((await call("/drafts/one/publish", "manager", "POST", fields)).status, 400);
    assert.equal((await call("/drafts/one/publish", "manager", "POST", { ...fields, title: "Update", serviceId: "missing" })).status, 400);
    assert.equal(published, 0);
    const send = await call("/drafts/one/publish", "manager", "POST", { ...fields, title: "Update", serviceId: "service-one" });
    assert.equal(send.status, 200);
    assert.equal(published, 1);
    assert.equal(notifications, 1);
    assert.equal((await call("/drafts/missing", "master")).status, 404);
    assert.equal((await call("/drafts/one", "manager", "DELETE")).status, 204);
    assert.equal(notifications, 1, "deleting never invokes customer notification code");
    failNotifications = true;
    const warning = await call("/drafts/second/publish", "manager", "POST", { ...fields, title: "Second update", serviceId: "service-one" });
    assert.equal(warning.status, 200, "a committed publication is not misreported as an unpublished draft");
    assert.match((await warning.json()).notificationWarning, /published.*notifications could not/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
