import { test } from "node:test";
import assert from "node:assert/strict";
import { createAdminUserNotificationsHandler } from "./admin-user-notifications-route";
import type { UserNotification } from "@shared/schema";

// Exercises the REAL admin customer-notification-history handler mounted in
// server/routes.ts. The permission gate (requirePermission) is tested centrally
// in server/require-permission.test.ts, so here we cover the handler's own
// contract: user scoping (404), the dismissed-inclusive read, correct
// pagination pass-through + hasMore, the type filter, and the locked row shape.

type Res = {
  statusCode: number;
  body: any;
  status: (n: number) => Res;
  json: (b: any) => Res;
};
function makeRes(): Res {
  const r: any = {
    statusCode: 200,
    body: undefined,
    status(n: number) { r.statusCode = n; return r; },
    json(b: any) { r.body = b; return r; },
  };
  return r;
}

function makeNotif(over: Partial<UserNotification> = {}): UserNotification {
  return {
    id: over.id ?? "n1",
    userId: over.userId ?? "u1",
    type: over.type ?? "news",
    title: over.title ?? "Title",
    body: over.body ?? "Body",
    referenceType: over.referenceType ?? null,
    referenceId: over.referenceId ?? null,
    url: over.url ?? null,
    readAt: over.readAt ?? null,
    dismissedAt: over.dismissedAt ?? null,
    createdAt: over.createdAt ?? new Date("2026-01-01T00:00:00Z"),
  } as UserNotification;
}

interface Captured {
  userId?: string;
  limit?: number;
  offset?: number;
  type?: string | null;
}

function makeHandler(opts: {
  user?: { id: string };
  rows?: UserNotification[];
  captured?: Captured;
}) {
  return createAdminUserNotificationsHandler({
    async getUser(id) {
      if (opts.user && opts.user.id === id) return opts.user;
      return opts.user; // default: found
    },
    async listNotifications(userId, limit, offset, type) {
      if (opts.captured) {
        opts.captured.userId = userId;
        opts.captured.limit = limit;
        opts.captured.offset = offset;
        opts.captured.type = type;
      }
      return opts.rows ?? [];
    },
  });
}

test("404 when the target user does not exist", async () => {
  const handler = createAdminUserNotificationsHandler({
    async getUser() { return undefined; },
    async listNotifications() { return []; },
  });
  const res = makeRes();
  await handler({ params: { id: "ghost" }, query: {} } as any, res as any);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "User not found");
});

test("returns the customer's notifications scoped to the path user id", async () => {
  const captured: Captured = {};
  const handler = makeHandler({
    user: { id: "u1" },
    rows: [makeNotif({ id: "n1" })],
    captured,
  });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: {} } as any, res as any);
  assert.equal(res.statusCode, 200);
  assert.equal(captured.userId, "u1");
  assert.equal(res.body.notifications.length, 1);
  assert.equal(res.body.notifications[0].id, "n1");
});

test("includes dismissed rows and exposes read/dismissed state + type", async () => {
  const handler = makeHandler({
    user: { id: "u1" },
    rows: [
      makeNotif({ id: "read", readAt: new Date("2026-01-02T00:00:00Z") }),
      makeNotif({ id: "dismissed", dismissedAt: new Date("2026-01-03T00:00:00Z") }),
      makeNotif({ id: "unseen", type: "whmcs_service_added" }),
    ],
  });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: {} } as any, res as any);
  const rows = res.body.notifications;
  assert.equal(rows.length, 3);
  const byId = Object.fromEntries(rows.map((r: any) => [r.id, r]));
  assert.ok(byId.read.readAt);
  assert.ok(byId.dismissed.dismissedAt);
  assert.equal(byId.unseen.readAt, null);
  assert.equal(byId.unseen.dismissedAt, null);
  assert.equal(byId.unseen.type, "whmcs_service_added");
});

test("passes the exact type filter through to storage", async () => {
  const captured: Captured = {};
  const handler = makeHandler({ user: { id: "u1" }, rows: [], captured });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: { type: "whmcs_service_added" } } as any, res as any);
  assert.equal(captured.type, "whmcs_service_added");
});

test("blank/absent type filter becomes null (no filter)", async () => {
  const captured: Captured = {};
  const handler = makeHandler({ user: { id: "u1" }, rows: [], captured });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: { type: "  " } } as any, res as any);
  assert.equal(captured.type, null);
});

test("pagination: default limit + offset, and clamps out-of-range values", async () => {
  const captured: Captured = {};
  const handler = makeHandler({ user: { id: "u1" }, rows: [], captured });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: {} } as any, res as any);
  // default page size is 30; handler fetches limit+1 to detect another page
  assert.equal(captured.limit, 31);
  assert.equal(captured.offset, 0);

  const captured2: Captured = {};
  const handler2 = makeHandler({ user: { id: "u1" }, rows: [], captured: captured2 });
  const res2 = makeRes();
  await handler2({ params: { id: "u1" }, query: { limit: "500", offset: "-5" } } as any, res2 as any);
  assert.equal(captured2.limit, 101); // clamped to MAX 100, +1 for lookahead
  assert.equal(captured2.offset, 0); // negative clamped to 0
});

test("hasMore true + extra row trimmed when storage returns limit+1 rows", async () => {
  // Ask for limit=2 → handler fetches 3; storage returns 3 → hasMore, trimmed to 2.
  const rows = [makeNotif({ id: "a" }), makeNotif({ id: "b" }), makeNotif({ id: "c" })];
  const handler = makeHandler({ user: { id: "u1" }, rows });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: { limit: "2" } } as any, res as any);
  assert.equal(res.body.hasMore, true);
  assert.equal(res.body.notifications.length, 2);
  assert.deepEqual(res.body.notifications.map((r: any) => r.id), ["a", "b"]);
});

test("hasMore false when storage returns at most `limit` rows", async () => {
  const rows = [makeNotif({ id: "a" }), makeNotif({ id: "b" })];
  const handler = makeHandler({ user: { id: "u1" }, rows });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: { limit: "2" } } as any, res as any);
  assert.equal(res.body.hasMore, false);
  assert.equal(res.body.notifications.length, 2);
});

test("500 with a message when the storage read throws", async () => {
  const handler = createAdminUserNotificationsHandler({
    async getUser(id) { return { id }; },
    async listNotifications() { throw new Error("db down"); },
  });
  const res = makeRes();
  await handler({ params: { id: "u1" }, query: {} } as any, res as any);
  assert.equal(res.statusCode, 500);
  assert.ok(res.body.message);
});
