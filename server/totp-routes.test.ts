import { test } from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { registerAuth2FARoutes, type TotpRoutesStorage } from "./totp-routes";
import {
  ChallengeStore,
  hashBackupCode,
  generateTotpForTest,
} from "./totp";
import type { User, TotpBackupCode } from "@shared/schema";

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const [salt, key] = hash.split(":");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return key === derivedKey.toString("hex");
}

function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

function sanitizeUser(user: any) {
  const { password: _p, totpSecret: _t, ...safe } = user;
  return safe;
}

class FakeStorage implements TotpRoutesStorage {
  users = new Map<string, User>();
  backupCodes = new Map<string, TotpBackupCode>();

  async getUser(id: string) {
    const u = this.users.get(id);
    return u ? { ...u } : undefined;
  }
  async getUserByUsername(username: string) {
    for (const u of this.users.values()) {
      if (u.username === username) return { ...u };
    }
    return undefined;
  }
  async updateUser(id: string, data: Partial<User>) {
    const u = this.users.get(id);
    if (!u) return undefined;
    const merged = { ...u, ...data };
    this.users.set(id, merged);
    return { ...merged };
  }
  async listTotpBackupCodes(userId: string) {
    return Array.from(this.backupCodes.values()).filter((c) => c.userId === userId);
  }
  async replaceTotpBackupCodes(userId: string, codeHashes: string[]) {
    for (const [id, c] of this.backupCodes) {
      if (c.userId === userId) this.backupCodes.delete(id);
    }
    for (const codeHash of codeHashes) {
      const id = crypto.randomUUID();
      this.backupCodes.set(id, {
        id,
        userId,
        codeHash,
        usedAt: null,
        createdAt: new Date(),
      } as TotpBackupCode);
    }
  }
  async markTotpBackupCodeUsed(id: string) {
    const c = this.backupCodes.get(id);
    if (c) this.backupCodes.set(id, { ...c, usedAt: new Date() });
  }
  async deleteTotpBackupCodes(userId: string) {
    for (const [id, c] of this.backupCodes) {
      if (c.userId === userId) this.backupCodes.delete(id);
    }
  }
}

interface TestContext {
  app: express.Express;
  storage: FakeStorage;
  challenges: ChallengeStore;
  session: { userId: string | null };
  baseUrl: () => string;
  close: () => void;
}

async function makeApp(): Promise<TestContext> {
  const storage = new FakeStorage();
  const challenges = new ChallengeStore();
  const session: { userId: string | null } = { userId: null };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      get userId() { return session.userId ?? undefined; },
      set userId(v: string | undefined) { session.userId = v ?? null; },
      destroy(cb: () => void) { session.userId = null; cb(); },
    };
    next();
  });

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!session.userId) return res.status(401).json({ message: "Unauthorized" });
    next();
  };
  const requireMasterAdmin = async (req: Request, res: Response, next: NextFunction) => {
    if (!session.userId) return res.status(401).json({ message: "Unauthorized" });
    const u = await storage.getUser(session.userId);
    if (!u || u.role !== "master_admin") return res.status(403).json({ message: "Forbidden" });
    next();
  };

  registerAuth2FARoutes(app, {
    storage,
    challenges,
    verifyPassword,
    isAdminRole,
    sanitizeUser,
    logActivity: () => {},
    requireAuth,
    requireMasterAdmin,
  });

  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  return {
    app,
    storage,
    challenges,
    session,
    baseUrl: () => `http://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}

async function seedUser(
  storage: FakeStorage,
  opts: { id?: string; username: string; password: string; role: string; totpEnabled?: boolean },
): Promise<{ user: User; secret: string | null }> {
  const id = opts.id ?? crypto.randomUUID();
  const passwordHash = await hashPassword(opts.password);
  let secret: string | null = null;
  if (opts.totpEnabled) {
    const { generateTotpSecret } = await import("./totp");
    secret = generateTotpSecret();
  }
  const user = {
    id,
    username: opts.username,
    password: passwordHash,
    fullName: opts.username,
    email: `${opts.username}@test.local`,
    role: opts.role,
    totpSecret: secret,
    totpEnabledAt: opts.totpEnabled ? new Date() : null,
  } as unknown as User;
  storage.users.set(id, user);
  return { user, secret };
}

async function http(ctx: TestContext, method: string, path: string, body?: any) {
  const r = await fetch(`${ctx.baseUrl()}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, body: json };
}

test("admin can enable 2FA via setup -> activate happy path", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "admin1", password: "pw", role: "admin",
    });
    ctx.session.userId = user.id;

    const setup = await http(ctx, "POST", "/api/auth/2fa/setup");
    assert.equal(setup.status, 200);
    assert.ok(typeof setup.body.secret === "string" && setup.body.secret.length > 0);
    assert.ok(setup.body.qrDataUrl.startsWith("data:image/"));

    const status1 = await http(ctx, "GET", "/api/auth/2fa/status");
    assert.equal(status1.body.enabled, false);
    assert.equal(status1.body.setupPending, true);

    const code = generateTotpForTest(setup.body.secret);
    const activate = await http(ctx, "POST", "/api/auth/2fa/activate", { code });
    assert.equal(activate.status, 200);
    assert.equal(activate.body.backupCodes.length, 10);

    const status2 = await http(ctx, "GET", "/api/auth/2fa/status");
    assert.equal(status2.body.enabled, true);
    assert.equal(status2.body.remainingBackupCodes, 10);
  } finally {
    ctx.close();
  }
});

test("activate rejects an invalid code and does not enable 2FA", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "admin2", password: "pw", role: "admin",
    });
    ctx.session.userId = user.id;
    await http(ctx, "POST", "/api/auth/2fa/setup");
    const r = await http(ctx, "POST", "/api/auth/2fa/activate", { code: "000000" });
    assert.equal(r.status, 401);
    const fresh = await ctx.storage.getUser(user.id);
    assert.equal(fresh?.totpEnabledAt, null);
  } finally {
    ctx.close();
  }
});

test("customers cannot enable 2FA via setup or activate", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "cust", password: "pw", role: "customer",
    });
    ctx.session.userId = user.id;
    const setup = await http(ctx, "POST", "/api/auth/2fa/setup");
    assert.equal(setup.status, 403);
    const activate = await http(ctx, "POST", "/api/auth/2fa/activate", { code: "123456" });
    assert.equal(activate.status, 403);
  } finally {
    ctx.close();
  }
});

test("login two-step: TOTP code completes login", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "admin3", password: "secret", role: "admin", totpEnabled: true,
    });

    const login = await http(ctx, "POST", "/api/auth/login", {
      username: "admin3", password: "secret",
    });
    assert.equal(login.status, 200);
    assert.equal(login.body.twoFactorRequired, true);
    assert.equal(typeof login.body.challengeId, "string");
    assert.equal(ctx.session.userId, null, "session should not be set until 2FA verifies");

    const code = generateTotpForTest(user.totpSecret!);
    const verify = await http(ctx, "POST", "/api/auth/2fa/verify", {
      challengeId: login.body.challengeId, code,
    });
    assert.equal(verify.status, 200);
    assert.equal(verify.body.id, user.id);
    assert.equal(verify.body.password, undefined);
    assert.equal(verify.body.totpSecret, undefined);
    assert.equal(ctx.session.userId, user.id);
  } finally {
    ctx.close();
  }
});

test("login two-step: backup code works once and is then invalidated", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "admin4", password: "pw", role: "admin", totpEnabled: true,
    });
    const backupRaw = "ABCDE-12345";
    await ctx.storage.replaceTotpBackupCodes(user.id, [hashBackupCode(backupRaw)]);

    const login1 = await http(ctx, "POST", "/api/auth/login", { username: "admin4", password: "pw" });
    assert.equal(login1.body.twoFactorRequired, true);
    const v1 = await http(ctx, "POST", "/api/auth/2fa/verify", {
      challengeId: login1.body.challengeId, code: backupRaw,
    });
    assert.equal(v1.status, 200);
    assert.equal(ctx.session.userId, user.id);

    ctx.session.userId = null;
    const login2 = await http(ctx, "POST", "/api/auth/login", { username: "admin4", password: "pw" });
    const v2 = await http(ctx, "POST", "/api/auth/2fa/verify", {
      challengeId: login2.body.challengeId, code: backupRaw,
    });
    assert.equal(v2.status, 401, "reused backup code must be rejected");
    assert.equal(ctx.session.userId, null);
  } finally {
    ctx.close();
  }
});

test("login two-step: 5 wrong attempts lock the challenge", async () => {
  const ctx = await makeApp();
  try {
    await seedUser(ctx.storage, {
      username: "admin5", password: "pw", role: "admin", totpEnabled: true,
    });
    const login = await http(ctx, "POST", "/api/auth/login", { username: "admin5", password: "pw" });
    const challengeId = login.body.challengeId;

    for (let i = 0; i < 5; i++) {
      const r = await http(ctx, "POST", "/api/auth/2fa/verify", { challengeId, code: "000000" });
      assert.equal(r.status, 401, `attempt ${i + 1} should reject as invalid code`);
    }
    const sixth = await http(ctx, "POST", "/api/auth/2fa/verify", { challengeId, code: "000000" });
    assert.equal(sixth.status, 429, "6th attempt must be locked");
    assert.equal(ctx.session.userId, null);
  } finally {
    ctx.close();
  }
});

test("login two-step: invalid challenge id yields 400", async () => {
  const ctx = await makeApp();
  try {
    const r = await http(ctx, "POST", "/api/auth/2fa/verify", {
      challengeId: "deadbeef", code: "000000",
    });
    assert.equal(r.status, 400);
  } finally {
    ctx.close();
  }
});

test("login: bad password returns 401 and never opens a challenge", async () => {
  const ctx = await makeApp();
  try {
    await seedUser(ctx.storage, {
      username: "admin6", password: "right", role: "admin", totpEnabled: true,
    });
    const r = await http(ctx, "POST", "/api/auth/login", { username: "admin6", password: "wrong" });
    assert.equal(r.status, 401);
    assert.equal(ctx.challenges.size(), 0);
  } finally {
    ctx.close();
  }
});

test("disable 2FA requires both password and current code", async () => {
  const ctx = await makeApp();
  try {
    const { user } = await seedUser(ctx.storage, {
      username: "admin7", password: "pw", role: "admin", totpEnabled: true,
    });
    ctx.session.userId = user.id;
    const code = generateTotpForTest(user.totpSecret!);

    const wrongPw = await http(ctx, "POST", "/api/auth/2fa/disable", { password: "nope", code });
    assert.equal(wrongPw.status, 401);

    const wrongCode = await http(ctx, "POST", "/api/auth/2fa/disable", { password: "pw", code: "000000" });
    assert.equal(wrongCode.status, 401);

    const ok = await http(ctx, "POST", "/api/auth/2fa/disable", { password: "pw", code });
    assert.equal(ok.status, 200);
    const fresh = await ctx.storage.getUser(user.id);
    assert.equal(fresh?.totpEnabledAt, null);
    assert.equal(fresh?.totpSecret, null);
  } finally {
    ctx.close();
  }
});

test("master admin can force-disable 2FA for another user", async () => {
  const ctx = await makeApp();
  try {
    const { user: master } = await seedUser(ctx.storage, {
      username: "master", password: "pw", role: "master_admin",
    });
    const { user: target } = await seedUser(ctx.storage, {
      username: "victim", password: "pw", role: "admin", totpEnabled: true,
    });
    await ctx.storage.replaceTotpBackupCodes(target.id, [hashBackupCode("AAAAA-BBBBB")]);

    ctx.session.userId = master.id;
    const ok = await http(ctx, "POST", `/api/admin/users/${target.id}/disable-2fa`);
    assert.equal(ok.status, 200);
    const fresh = await ctx.storage.getUser(target.id);
    assert.equal(fresh?.totpEnabledAt, null);
    assert.equal(fresh?.totpSecret, null);
    assert.equal((await ctx.storage.listTotpBackupCodes(target.id)).length, 0);
  } finally {
    ctx.close();
  }
});

test("non-master admin cannot force-disable another user's 2FA", async () => {
  const ctx = await makeApp();
  try {
    const { user: regular } = await seedUser(ctx.storage, {
      username: "reg", password: "pw", role: "admin",
    });
    const { user: target } = await seedUser(ctx.storage, {
      username: "victim2", password: "pw", role: "admin", totpEnabled: true,
    });
    ctx.session.userId = regular.id;
    const r = await http(ctx, "POST", `/api/admin/users/${target.id}/disable-2fa`);
    assert.equal(r.status, 403);
    const fresh = await ctx.storage.getUser(target.id);
    assert.ok(fresh?.totpEnabledAt, "2FA should still be enabled");
  } finally {
    ctx.close();
  }
});

test("force-disable returns 400 when the target has no 2FA configured", async () => {
  const ctx = await makeApp();
  try {
    const { user: master } = await seedUser(ctx.storage, {
      username: "master2", password: "pw", role: "master_admin",
    });
    const { user: target } = await seedUser(ctx.storage, {
      username: "noprot", password: "pw", role: "admin",
    });
    ctx.session.userId = master.id;
    const r = await http(ctx, "POST", `/api/admin/users/${target.id}/disable-2fa`);
    assert.equal(r.status, 400);
  } finally {
    ctx.close();
  }
});

test("force-disable returns 404 for an unknown user", async () => {
  const ctx = await makeApp();
  try {
    const { user: master } = await seedUser(ctx.storage, {
      username: "master3", password: "pw", role: "master_admin",
    });
    ctx.session.userId = master.id;
    const r = await http(ctx, "POST", `/api/admin/users/${crypto.randomUUID()}/disable-2fa`);
    assert.equal(r.status, 404);
  } finally {
    ctx.close();
  }
});
