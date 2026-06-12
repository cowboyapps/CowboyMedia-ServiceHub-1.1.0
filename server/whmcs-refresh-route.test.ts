import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createBillingRefreshHandler,
  type RefreshRouteDeps,
} from "./whmcs-refresh-route";

// Route-level tests for the customer billing-cache refresh endpoint:
//   POST /api/billing/refresh
//
// These exercise the PRODUCTION handler factory from
// server/whmcs-refresh-route.ts (wired into routes.ts), not a copy. The two
// safety-critical contracts:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user, so the
//      handler only ever invalidates the CALLER'S OWN cache. Request input
//      (body/query) can never widen that to another client's cache.
//   2. The handler never 500s: an unlinked user and a throwing storage layer
//      both still resolve to { ok: true }.

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null } | undefined>;
  getUser?: RefreshRouteDeps["getUser"];
  invalidateBillingCaches?: RefreshRouteDeps["invalidateBillingCaches"];
}

function makeApp(opts: AppOpts, invalidated: number[]) {
  const deps: RefreshRouteDeps = {
    getUser: opts.getUser ?? (async (id: string) => opts.users[id]),
    invalidateBillingCaches:
      opts.invalidateBillingCaches ?? ((clientId: number) => { invalidated.push(clientId); }),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.post("/api/billing/refresh", createBillingRefreshHandler(deps));
  return app;
}

async function call(app: express.Express, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

// ---------- ownership ----------

test("invalidates ONLY the caller's own linked client id", async () => {
  const invalidated: number[] = [];
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 5 } } }, invalidated);
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(invalidated, [5]);
});

test("client id comes from the session, NOT the request body", async () => {
  const invalidated: number[] = [];
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 5 } } }, invalidated);
  // Attacker tries to smuggle a foreign clientId in the body — must be ignored.
  const { status, body } = await call(app, { clientId: 999, clientid: 999, whmcsClientId: 999 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  // Only the session user's own client (5) is busted — never the smuggled 999.
  assert.deepEqual(invalidated, [5]);
});

test("getUser is looked up by the SESSION user id", async () => {
  const invalidated: number[] = [];
  let seenLookupId: string | undefined;
  const app = makeApp(
    {
      sessionUserId: "u-session",
      users: {},
      getUser: async (id: string) => {
        seenLookupId = id;
        return { whmcsClientId: 42 };
      },
    },
    invalidated,
  );
  const { status, body } = await call(app, { userId: "attacker" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(seenLookupId, "u-session");
  assert.deepEqual(invalidated, [42]);
});

// ---------- never 500s / degraded paths ----------

test("returns { ok: true } and invalidates nothing when the user is unlinked", async () => {
  const invalidated: number[] = [];
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } } }, invalidated);
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(invalidated, []);
});

test("returns { ok: true } and invalidates nothing when the user doesn't exist", async () => {
  const invalidated: number[] = [];
  const app = makeApp({ sessionUserId: "ghost", users: {} }, invalidated);
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(invalidated, []);
});

test("never 500s when storage.getUser throws", async () => {
  const invalidated: number[] = [];
  const app = makeApp(
    {
      sessionUserId: "u1",
      users: {},
      getUser: async () => { throw new Error("db down"); },
    },
    invalidated,
  );
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(invalidated, []);
});

test("never 500s when invalidateBillingCaches throws", async () => {
  const app = makeApp(
    {
      sessionUserId: "u1",
      users: { u1: { whmcsClientId: 5 } },
      invalidateBillingCaches: () => { throw new Error("cache boom"); },
    },
    [],
  );
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});
