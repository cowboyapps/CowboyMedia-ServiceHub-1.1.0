import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import {
  createWhmcsLinkRequestHandler,
  createWhmcsLinkVerifyHandler,
  WHMCS_LINK_CODE_TTL_MS,
  WHMCS_LINK_MAX_ATTEMPTS,
  type WhmcsLinkRouteUser,
  type WhmcsLinkClientLookup,
} from "./whmcs-link-route";
import type { WhmcsLinkVerification } from "@shared/schema";

// Route-level tests for the customer self-service WHMCS account-linking flow:
//   POST /api/whmcs/link/request   (email a 6-digit code)
//   POST /api/whmcs/link/verify    (prove the code → establish the link)
//
// These exercise the PRODUCTION handler factories from server/whmcs-link-route.ts
// (wired into routes.ts), not a copy — so a regression in the security-critical
// status machine (the ownership gate) is caught here. Every external seam
// (storage, WHMCS lookup, email, activity log, clock) is injected and backed by
// a single in-memory store so request → verify runs end-to-end.

interface HarnessOpts {
  sessionUserId?: string | null;
  /** The logged-in (and any conflicting) users, keyed by id. */
  users?: Record<string, WhmcsLinkRouteUser>;
  configured?: boolean;
  enabled?: boolean;
  /** What getClientByEmail returns for the requested email. */
  lookup?: WhmcsLinkClientLookup;
  /** Fixed clock; defaults to a real-ish now. */
  now?: () => number;
}

interface EmailCapture {
  to: string;
  templateKey: string;
  vars: Record<string, string>;
}

function makeHarness(opts: HarnessOpts) {
  const users: Record<string, WhmcsLinkRouteUser> = { ...(opts.users ?? {}) };
  const verifications: WhmcsLinkVerification[] = [];
  const emails: EmailCapture[] = [];
  const activity: Array<{ action: string; actorId?: string }> = [];
  let idSeq = 0;
  const sessionUserId = opts.sessionUserId === undefined ? "u1" : opts.sessionUserId;
  const now = opts.now ?? (() => Date.now());

  const getUser = async (id: string) => users[id];
  const getUserByWhmcsClientId = async (clientId: number) => {
    const hit = Object.values(users).find((u) => u.whmcsClientId === clientId);
    return hit ? { id: hit.id } : undefined;
  };
  const getActiveWhmcsLinkVerification = async (userId: string) => {
    const row = [...verifications]
      .filter((v) => v.userId === userId && v.consumedAt == null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    // Return a SNAPSHOT (like a DB read) so a later in-memory bump/consume can't
    // retroactively mutate the row reference the handler is holding — that would
    // mask the production behaviour where `v` is a detached row.
    return row ? { ...row } : undefined;
  };

  const logActivity = (_c: string, action: string, o: { actorId?: string }) =>
    activity.push({ action, actorId: o.actorId });

  const requestHandler = createWhmcsLinkRequestHandler({
    getLinkConfig: async () => ({ configured: opts.configured ?? true, enabled: opts.enabled ?? true }),
    getUser,
    getUserByWhmcsClientId,
    getClientByEmail: async () => opts.lookup ?? { ok: true, client: null },
    createWhmcsLinkVerification: async (data) => {
      const row: WhmcsLinkVerification = {
        id: `v${++idSeq}`,
        userId: data.userId,
        email: data.email,
        codeHash: data.codeHash,
        whmcsClientId: data.whmcsClientId,
        attempts: data.attempts ?? 0,
        expiresAt: data.expiresAt,
        consumedAt: null,
        createdAt: new Date(now()),
      };
      verifications.push(row);
      return row;
    },
    sendTemplatedEmail: (to, templateKey, vars) => {
      emails.push({ to, templateKey, vars });
      return undefined;
    },
    logActivity,
    now,
  });

  const verifyHandler = createWhmcsLinkVerifyHandler({
    getUser,
    getActiveWhmcsLinkVerification,
    getUserByWhmcsClientId,
    bumpWhmcsLinkVerificationAttempts: async (id) => {
      const row = verifications.find((v) => v.id === id);
      if (row) row.attempts += 1;
    },
    consumeWhmcsLinkVerification: async (id) => {
      const row = verifications.find((v) => v.id === id);
      if (row) row.consumedAt = new Date(now());
    },
    updateUser: async (id, data) => {
      users[id] = { ...users[id], whmcsClientId: data.whmcsClientId };
      return users[id];
    },
    logActivity,
    now,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: sessionUserId ?? undefined };
    next();
  });
  app.post("/request", requestHandler);
  app.post("/verify", verifyHandler);

  return { app, users, verifications, emails, activity };
}

async function post(app: express.Express, p: string, body: unknown): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${p}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const CLIENT = { id: 100, email: "owner@example.com", fullName: "Pat Owner" } as const;
const matchLookup: WhmcsLinkClientLookup = { ok: true, client: CLIENT };

// ---------------------------------------------------------------------------
// Happy path: request → verify → linked
// ---------------------------------------------------------------------------

test("end-to-end: request emails a code, verifying it links the account", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });

  const reqRes = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(reqRes.status, 200);
  assert.deepEqual(reqRes.body, { status: "code_sent" });
  // The code goes to the WHMCS-on-file address, never echoed in the response.
  assert.equal(h.emails.length, 1);
  assert.equal(h.emails[0].to, CLIENT.email);
  assert.equal(h.emails[0].templateKey, "whmcs_link_verification");
  const code = h.emails[0].vars.code;
  assert.match(code, /^\d{6}$/);

  const verRes = await post(h.app, "/verify", { code });
  assert.equal(verRes.status, 200);
  assert.deepEqual(verRes.body, { status: "linked" });
  // The link now points at the WHMCS client resolved server-side.
  assert.equal(h.users.u1.whmcsClientId, CLIENT.id);
  // The verification row was consumed (single-use).
  assert.ok(h.verifications[0].consumedAt != null);
  assert.deepEqual(h.activity.map((a) => a.action), ["whmcs_link_code_requested", "whmcs_self_linked"]);
});

// ---------------------------------------------------------------------------
// Request-side gates
// ---------------------------------------------------------------------------

test("request: empty email → 400 invalid", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  const r = await post(h.app, "/request", { email: "   " });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, "invalid");
  assert.equal(h.emails.length, 0);
});

test("request: already-linked user → already_linked, no code emailed", async () => {
  const h = makeHarness({ users: { u1: { id: "u1", whmcsClientId: 7 } }, lookup: matchLookup });
  const r = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(r.body.status, "already_linked");
  assert.equal(h.emails.length, 0);
});

test("request: WHMCS unconfigured → unavailable", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, configured: false, lookup: matchLookup });
  const r = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(r.body.status, "unavailable");
  assert.equal(h.emails.length, 0);
});

test("request: WHMCS disabled → unavailable", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, enabled: false, lookup: matchLookup });
  const r = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(r.body.status, "unavailable");
  assert.equal(h.emails.length, 0);
});

test("request: WHMCS lookup unreachable → unavailable (leaks nothing)", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: { ok: false } });
  const r = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(r.body.status, "unavailable");
  assert.equal(h.emails.length, 0);
});

test("request: no WHMCS client with that email → no_match", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: { ok: true, client: null } });
  const r = await post(h.app, "/request", { email: "nobody@example.com" });
  assert.equal(r.body.status, "no_match");
  assert.equal(h.emails.length, 0);
});

test("request: another user already owns the WHMCS client → conflict at request time", async () => {
  const h = makeHarness({
    users: { u1: { id: "u1" }, other: { id: "other", whmcsClientId: CLIENT.id } },
    lookup: matchLookup,
  });
  const r = await post(h.app, "/request", { email: "owner@example.com" });
  assert.equal(r.body.status, "conflict");
  assert.equal(h.emails.length, 0, "no code is emailed when the client is already claimed");
});

// ---------------------------------------------------------------------------
// Verify-side gates
// ---------------------------------------------------------------------------

test("verify: malformed code → 400 invalid_code", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  const r = await post(h.app, "/verify", { code: "12ab" });
  assert.equal(r.status, 400);
  assert.equal(r.body.status, "invalid_code");
});

test("verify: no outstanding verification → expired", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  const r = await post(h.app, "/verify", { code: "123456" });
  assert.equal(r.body.status, "expired");
});

test("verify: wrong code → invalid_code with decreasing attemptsRemaining", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  await post(h.app, "/request", { email: "owner@example.com" });
  const realCode = h.emails[0].vars.code;
  const wrong = realCode === "000000" ? "000001" : "000000";

  const r1 = await post(h.app, "/verify", { code: wrong });
  assert.equal(r1.body.status, "invalid_code");
  assert.equal(r1.body.attemptsRemaining, WHMCS_LINK_MAX_ATTEMPTS - 1);

  const r2 = await post(h.app, "/verify", { code: wrong });
  assert.equal(r2.body.status, "invalid_code");
  assert.equal(r2.body.attemptsRemaining, WHMCS_LINK_MAX_ATTEMPTS - 2);

  // The account is still unlinked after wrong tries.
  assert.equal(h.users.u1.whmcsClientId ?? null, null);
});

test("verify: expired code → expired and the row is consumed", async () => {
  let clock = 1_000_000;
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup, now: () => clock });
  await post(h.app, "/request", { email: "owner@example.com" });
  const code = h.emails[0].vars.code;
  // Jump past the TTL.
  clock += WHMCS_LINK_CODE_TTL_MS + 1;
  const r = await post(h.app, "/verify", { code });
  assert.equal(r.body.status, "expired");
  assert.equal(h.users.u1.whmcsClientId ?? null, null);
  assert.ok(h.verifications[0].consumedAt != null, "expired row must be consumed");
});

test("verify: too_many_attempts after the wrong-attempt cap is hit", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  await post(h.app, "/request", { email: "owner@example.com" });
  const realCode = h.emails[0].vars.code;
  const wrong = realCode === "000000" ? "000001" : "000000";

  // Burn through all allowed wrong attempts.
  for (let i = 0; i < WHMCS_LINK_MAX_ATTEMPTS; i++) {
    const r = await post(h.app, "/verify", { code: wrong });
    assert.equal(r.body.status, "invalid_code");
  }
  // The next attempt — even with the CORRECT code — is locked out.
  const locked = await post(h.app, "/verify", { code: realCode });
  assert.equal(locked.body.status, "too_many_attempts");
  assert.equal(h.users.u1.whmcsClientId ?? null, null);
});

test("verify: another user claimed the client between request and verify → conflict, not linked", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  await post(h.app, "/request", { email: "owner@example.com" });
  const code = h.emails[0].vars.code;
  // A racing user grabs the same WHMCS client before we verify.
  h.users.racer = { id: "racer", whmcsClientId: CLIENT.id };

  const r = await post(h.app, "/verify", { code });
  assert.equal(r.body.status, "conflict");
  assert.equal(h.users.u1.whmcsClientId ?? null, null, "loser of the race is not linked");
  assert.ok(h.verifications[0].consumedAt != null, "the row is consumed on conflict");
});

test("verify: already-linked user short-circuits to already_linked", async () => {
  const h = makeHarness({ users: { u1: { id: "u1", whmcsClientId: 9 } }, lookup: matchLookup });
  const r = await post(h.app, "/verify", { code: "123456" });
  assert.equal(r.body.status, "already_linked");
});

// ---------------------------------------------------------------------------
// Security: constant-time compare + no client-supplied clientId
// ---------------------------------------------------------------------------

test("verify: a request-supplied clientId is ignored — the link uses the stored row's client", async () => {
  const h = makeHarness({ users: { u1: { id: "u1" } }, lookup: matchLookup });
  await post(h.app, "/request", { email: "owner@example.com" });
  const code = h.emails[0].vars.code;

  // Attacker tacks a foreign client id onto the verify body. The handler must
  // link the id captured server-side at request time (CLIENT.id=100), never 999.
  const r = await post(h.app, "/verify", { code, clientId: 999, whmcsClientId: 999, userid: 999 });
  assert.equal(r.body.status, "linked");
  assert.equal(h.users.u1.whmcsClientId, CLIENT.id);
  assert.notEqual(h.users.u1.whmcsClientId, 999);
});

test("verify source uses a constant-time compare and never reads a clientId from the request body", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(here, "whmcs-link-route.ts"), "utf8");
  // The code comparison must be constant-time to avoid a timing oracle on the OTP.
  assert.ok(src.includes("crypto.timingSafeEqual"), "verify must use crypto.timingSafeEqual");
  assert.ok(!/===\s*v\.codeHash/.test(src), "must not use a short-circuiting === on the code hash");
  // The verify handler resolves the WHMCS client id from the stored row only.
  assert.ok(src.includes("v.whmcsClientId"), "link must use the stored verification's client id");
  // No path reads a client/clientId off req.body.
  assert.ok(!/req\.body[^\n]*client/i.test(src), "must not read any clientId from req.body");
});
