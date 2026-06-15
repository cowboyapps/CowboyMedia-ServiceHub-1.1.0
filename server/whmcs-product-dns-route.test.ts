import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createListProductDnsHandler,
  createSetProductDnsHandler,
  type ProductDnsRouteDeps,
  type ProductDnsRow,
} from "./whmcs-product-dns-route";
import { createRequireAdmin, type AccessGuardUser } from "./require-permission";

// Tests for the admin per-product DNS endpoints (Task #473). These exercise the
// PRODUCTION handler factories wired into routes.ts plus the SAME requireAdmin
// guard, with an in-memory fake standing in for storage so no DB is touched.
// Contracts:
//   1. requireAdmin gates both routes (401 unauth, 403 non-admin).
//   2. PUT validates the WHMCS product id (400 on a bad/missing pid).
//   3. PUT upserts and clears, GET reads back — persisted through the same fake.
//   4. Handlers never 500 on a thrown storage error (tagged JSON, 500 status).

// In-memory stand-in mirroring storage's upsert/clear semantics.
function makeFakeStore() {
  const map = new Map<number, string>();
  const deps: ProductDnsRouteDeps = {
    listProductDns: async () =>
      [...map.entries()].map(([whmcsProductId, dns]) => ({ whmcsProductId, dns })),
    setProductDns: async (whmcsProductId, dns) => {
      const trimmed = dns.trim();
      if (!trimmed) {
        map.delete(whmcsProductId);
        return undefined;
      }
      map.set(whmcsProductId, trimmed);
      return { dns: trimmed };
    },
  };
  return { map, deps };
}

function makeApp(deps: ProductDnsRouteDeps, opts: { sessionUserId?: string | null; users: Record<string, AccessGuardUser | undefined> }) {
  const requireAdmin = createRequireAdmin({ getUser: async (id) => opts.users[id] });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/admin/whmcs/product-dns", requireAdmin, createListProductDnsHandler(deps));
  app.put("/api/admin/whmcs/product-dns", requireAdmin, createSetProductDnsHandler(deps));
  return app;
}

async function req(app: express.Express, method: "GET" | "PUT", body?: any) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/whmcs/product-dns`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const admins = { a: { role: "admin" } as AccessGuardUser };

// --- auth gating -----------------------------------------------------------

test("admin DNS routes: 401 when unauthenticated", async () => {
  const { deps } = makeFakeStore();
  const app = makeApp(deps, { sessionUserId: null, users: {} });
  assert.equal((await req(app, "GET")).status, 401);
  assert.equal((await req(app, "PUT", { whmcsProductId: 1, dns: "x" })).status, 401);
});

test("admin DNS routes: 403 for a non-admin (customer) session", async () => {
  const { deps } = makeFakeStore();
  const app = makeApp(deps, { sessionUserId: "c", users: { c: { role: "customer" } } });
  assert.equal((await req(app, "GET")).status, 403);
  assert.equal((await req(app, "PUT", { whmcsProductId: 1, dns: "x" })).status, 403);
});

// --- validation ------------------------------------------------------------

test("PUT DNS: rejects a missing / non-positive product id with 400", async () => {
  const { deps } = makeFakeStore();
  const app = makeApp(deps, { sessionUserId: "a", users: admins });
  assert.equal((await req(app, "PUT", { dns: "x" })).status, 400);
  assert.equal((await req(app, "PUT", { whmcsProductId: 0, dns: "x" })).status, 400);
  assert.equal((await req(app, "PUT", { whmcsProductId: -3, dns: "x" })).status, 400);
  assert.equal((await req(app, "PUT", { whmcsProductId: "abc", dns: "x" })).status, 400);
});

// --- persistence (upsert + clear) ------------------------------------------

test("PUT DNS: upserts, trims, GET reads it back, then clears on empty", async () => {
  const { map, deps } = makeFakeStore();
  const app = makeApp(deps, { sessionUserId: "a", users: admins });

  // Upsert (trimmed).
  const saved = await req(app, "PUT", { whmcsProductId: 10, dns: "  host.example.com  " });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.equal(saved.body.whmcsProductId, 10);
  assert.equal(saved.body.dns, "host.example.com");
  assert.equal(map.get(10), "host.example.com");

  // GET reads it back in the locked { entries } shape.
  const list = await req(app, "GET");
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.entries, [{ whmcsProductId: 10, dns: "host.example.com" }]);

  // Re-PUT updates in place (no duplicate row).
  await req(app, "PUT", { whmcsProductId: 10, dns: "new.example.com" });
  assert.equal(map.size, 1);
  assert.equal(map.get(10), "new.example.com");

  // Empty dns clears the row and returns "".
  const cleared = await req(app, "PUT", { whmcsProductId: 10, dns: "   " });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.dns, "");
  assert.equal(map.has(10), false);
  assert.deepEqual((await req(app, "GET")).body.entries, []);
});

test("PUT DNS: logs an audit entry with set=true on upsert, set=false on clear", async () => {
  const { deps } = makeFakeStore();
  const seen: Array<{ whmcsProductId: number; set: boolean }> = [];
  const app = makeApp(
    { ...deps, logActivity: ({ whmcsProductId, set }) => seen.push({ whmcsProductId, set }) },
    { sessionUserId: "a", users: admins },
  );
  await req(app, "PUT", { whmcsProductId: 7, dns: "h" });
  await req(app, "PUT", { whmcsProductId: 7, dns: "" });
  assert.deepEqual(seen, [
    { whmcsProductId: 7, set: true },
    { whmcsProductId: 7, set: false },
  ]);
});

// --- reliability -----------------------------------------------------------

test("admin DNS routes: a thrown storage error degrades to a 500 JSON, never crashes", async () => {
  const deps: ProductDnsRouteDeps = {
    listProductDns: async () => { throw new Error("list boom"); },
    setProductDns: async () => { throw new Error("set boom"); },
  };
  const app = makeApp(deps, { sessionUserId: "a", users: admins });
  const g = await req(app, "GET");
  assert.equal(g.status, 500);
  assert.equal(g.body.message, "list boom");
  const p = await req(app, "PUT", { whmcsProductId: 1, dns: "x" });
  assert.equal(p.status, 500);
  assert.equal(p.body.message, "set boom");
});

// --- storage round-trip (real DB, skips when unconfigured) -----------------

test("storage: setWhmcsProductDns upserts/clears and list/get read back", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const { storage } = await import("./storage");
  // Use a product id far above any real WHMCS pid to avoid colliding with data.
  const pid = 990473;
  try {
    const saved = await storage.setWhmcsProductDns(pid, "  vps.test.local  ");
    assert.ok(saved);
    assert.equal(saved!.dns, "vps.test.local");

    const got = await storage.getWhmcsProductDns(pid);
    assert.equal(got?.dns, "vps.test.local");
    assert.ok((await storage.listWhmcsProductDns()).some((r) => r.whmcsProductId === pid && r.dns === "vps.test.local"));

    // Upsert updates the same row.
    const updated = await storage.setWhmcsProductDns(pid, "vps2.test.local");
    assert.equal(updated!.dns, "vps2.test.local");

    // Empty clears it.
    const cleared = await storage.setWhmcsProductDns(pid, "   ");
    assert.equal(cleared, undefined);
    assert.equal(await storage.getWhmcsProductDns(pid), undefined);
  } finally {
    await storage.setWhmcsProductDns(pid, "");
  }
});
