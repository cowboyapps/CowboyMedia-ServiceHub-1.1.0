import { test, after } from "node:test";
import assert from "node:assert/strict";
import express, { type Request, type Response, type NextFunction } from "express";
import type { AddressInfo } from "node:net";
import {
  createLoginLimiter,
  createRegisterLimiter,
  createPasswordResetLimiter,
  createTicketLimiter,
  createCommunityChatPostLimiter,
  createCommunityChatReactionLimiter,
  createReportLimiter,
  createWhmcsLinkRequestLimiter,
  createWhmcsLinkVerifyLimiter,
  bypassRateLimitForAdmins,
} from "./rate-limits";
import { storage } from "./storage";
import { pool } from "./db";
import type { User } from "@shared/schema";

// Importing storage pulls in the pg pool, whose idle handles keep the process
// alive after the tests finish. Close it so the test subprocess exits cleanly.
after(async () => {
  await pool.end();
});

type Role = "customer" | "admin" | "master_admin";

interface FakeSession {
  userId?: string;
}

function withSession(role: Role | null, userId?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const session: FakeSession = userId ? { userId } : {};
    (req as any).session = session;
    if (role === "admin" || role === "master_admin") {
      (req as any).skipRateLimit = true;
    }
    next();
  };
}

async function startApp(configure: (app: express.Express) => void): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  configure(app);
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function postJson(url: string, body: unknown = {}, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

// ---------- Login limiter ----------

test("login limiter: allows 5 failures, blocks the 6th", async () => {
  const { url, close } = await startApp((app) => {
    app.post("/login", createLoginLimiter(), (_req, res) => {
      res.status(401).json({ ok: false });
    });
  });
  try {
    const body = { username: "alice", password: "nope" };
    for (let i = 0; i < 5; i++) {
      const r = await postJson(`${url}/login`, body);
      assert.equal(r.status, 401, `attempt ${i + 1} should still be allowed`);
    }
    const blocked = await postJson(`${url}/login`, body);
    assert.equal(blocked.status, 429);
    const json = await blocked.json();
    assert.equal(json.error, "Too many requests. Please slow down and try again shortly.");
    assert.ok(typeof json.retryAfterSeconds === "number" && json.retryAfterSeconds > 0);
    assert.ok(blocked.headers.get("retry-after"));
  } finally {
    await close();
  }
});

test("login limiter: successful logins do not consume the budget", async () => {
  const { url, close } = await startApp((app) => {
    app.post("/login", createLoginLimiter(), (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    const body = { username: "bob", password: "right" };
    for (let i = 0; i < 12; i++) {
      const r = await postJson(`${url}/login`, body);
      assert.equal(r.status, 200, `successful attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

test("login limiter: separate username buckets do not interfere", async () => {
  const { url, close } = await startApp((app) => {
    app.post("/login", createLoginLimiter(), (_req, res) => {
      res.status(401).json({ ok: false });
    });
  });
  try {
    for (let i = 0; i < 5; i++) {
      const r = await postJson(`${url}/login`, { username: "u1", password: "x" });
      assert.equal(r.status, 401);
    }
    const blocked = await postJson(`${url}/login`, { username: "u1", password: "x" });
    assert.equal(blocked.status, 429);
    const otherUser = await postJson(`${url}/login`, { username: "u2", password: "x" });
    assert.equal(otherUser.status, 401);
  } finally {
    await close();
  }
});

// ---------- Register limiter ----------

test("register limiter: 10/hour/IP, 11th is blocked", async () => {
  const { url, close } = await startApp((app) => {
    app.post("/register", createRegisterLimiter(), (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await postJson(`${url}/register`, { username: `u${i}` });
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/register`, { username: "x" });
    assert.equal(blocked.status, 429);
  } finally {
    await close();
  }
});

// ---------- Password reset limiter ----------

test("password reset limiter: 3/hour/IP, 4th is blocked", async () => {
  const { url, close } = await startApp((app) => {
    app.post("/forgot", createPasswordResetLimiter(), (_req, res) => {
      res.json({ ok: true });
    });
  });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await postJson(`${url}/forgot`, { usernameOrEmail: "x" });
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/forgot`, { usernameOrEmail: "x" });
    assert.equal(blocked.status, 429);
    const json = await blocked.json();
    assert.ok(json.retryAfterSeconds > 0);
  } finally {
    await close();
  }
});

test("password reset limiter: forgot + reset share one budget per IP", async () => {
  const { url, close } = await startApp((app) => {
    // Same shared instance mounted on both endpoints, mirroring routes.ts.
    const shared = createPasswordResetLimiter();
    app.post("/forgot", shared, (_req, res) => res.json({ ok: true }));
    app.post("/reset", shared, (_req, res) => res.json({ ok: true }));
  });
  try {
    // 3 hits to forgot exhaust the IP's budget.
    for (let i = 0; i < 3; i++) {
      const r = await postJson(`${url}/forgot`, { usernameOrEmail: "x" });
      assert.equal(r.status, 200);
    }
    // The very next reset hit from the same IP should already be 429.
    const blockedReset = await postJson(`${url}/reset`, { token: "t", password: "p" });
    assert.equal(blockedReset.status, 429, "reset must inherit forgot's spent budget");
    // Forgot is also still blocked, confirming a single bucket.
    const blockedForgot = await postJson(`${url}/forgot`, { usernameOrEmail: "x" });
    assert.equal(blockedForgot.status, 429);
  } finally {
    await close();
  }
});

test("password reset limiter: reset hits also count against forgot's budget", async () => {
  const { url, close } = await startApp((app) => {
    const shared = createPasswordResetLimiter();
    app.post("/forgot", shared, (_req, res) => res.json({ ok: true }));
    app.post("/reset", shared, (_req, res) => res.json({ ok: true }));
  });
  try {
    for (let i = 0; i < 3; i++) {
      const r = await postJson(`${url}/reset`, { token: "t", password: "p" });
      assert.equal(r.status, 200);
    }
    const blockedForgot = await postJson(`${url}/forgot`, { usernameOrEmail: "x" });
    assert.equal(blockedForgot.status, 429, "forgot must inherit reset's spent budget");
  } finally {
    await close();
  }
});

// ---------- Ticket limiter ----------

test("ticket limiter: 10/hour/user, 11th is blocked, admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/tickets",
      withSession("customer", "user-A"),
      createTicketLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/tickets-admin",
      withSession("admin", "admin-A"),
      createTicketLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await postJson(`${url}/tickets`);
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/tickets`);
    assert.equal(blocked.status, 429);

    for (let i = 0; i < 25; i++) {
      const r = await postJson(`${url}/tickets-admin`);
      assert.equal(r.status, 200, `admin attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

// ---------- Community chat limiter ----------

test("community chat post limiter: 10/min/user, 11th is blocked, admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/chat",
      withSession("customer", "user-B"),
      createCommunityChatPostLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/chat-admin",
      withSession("admin", "admin-C"),
      createCommunityChatPostLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await postJson(`${url}/chat`);
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/chat`);
    assert.equal(blocked.status, 429);

    for (let i = 0; i < 25; i++) {
      const r = await postJson(`${url}/chat-admin`);
      assert.equal(r.status, 200, `admin chat attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

test("community chat reaction limiter: 60/min/user, 61st is blocked, admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/react",
      withSession("customer", "user-C"),
      createCommunityChatReactionLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/react-admin",
      withSession("master_admin", "admin-B"),
      createCommunityChatReactionLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 60; i++) {
      const r = await postJson(`${url}/react`);
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/react`);
    assert.equal(blocked.status, 429);

    for (let i = 0; i < 80; i++) {
      const r = await postJson(`${url}/react-admin`);
      assert.equal(r.status, 200);
    }
  } finally {
    await close();
  }
});

// ---------- Report limiter ----------

test("report limiter: 10/min/user, 11th is blocked, admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/reports",
      withSession("customer", "user-D"),
      createReportLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/reports-admin",
      withSession("master_admin", "admin-D"),
      createReportLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 10; i++) {
      const r = await postJson(`${url}/reports`);
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/reports`);
    assert.equal(blocked.status, 429);

    for (let i = 0; i < 25; i++) {
      const r = await postJson(`${url}/reports-admin`);
      assert.equal(r.status, 200, `admin report attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

// ---------- WHMCS account-linking limiters ----------

test("whmcs link request limiter: 5/15min/user, 6th is blocked, admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/whmcs/request",
      withSession("customer", "user-W1"),
      createWhmcsLinkRequestLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/whmcs/request-admin",
      withSession("admin", "admin-W1"),
      createWhmcsLinkRequestLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 5; i++) {
      const r = await postJson(`${url}/whmcs/request`);
      assert.equal(r.status, 200, `request attempt ${i + 1} should still be allowed`);
    }
    const blocked = await postJson(`${url}/whmcs/request`);
    assert.equal(blocked.status, 429);
    const json = await blocked.json();
    assert.equal(json.error, "Too many requests. Please slow down and try again shortly.");
    assert.ok(typeof json.retryAfterSeconds === "number" && json.retryAfterSeconds > 0);
    assert.ok(blocked.headers.get("retry-after"));

    for (let i = 0; i < 20; i++) {
      const r = await postJson(`${url}/whmcs/request-admin`);
      assert.equal(r.status, 200, `admin request attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

test("whmcs link verify limiter: 15/15min/user, 16th is blocked, master_admin bypasses", async () => {
  const { url, close } = await startApp((app) => {
    app.post(
      "/whmcs/verify",
      withSession("customer", "user-W2"),
      createWhmcsLinkVerifyLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/whmcs/verify-admin",
      withSession("master_admin", "admin-W2"),
      createWhmcsLinkVerifyLimiter(),
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 15; i++) {
      const r = await postJson(`${url}/whmcs/verify`);
      assert.equal(r.status, 200, `verify attempt ${i + 1} should still be allowed`);
    }
    const blocked = await postJson(`${url}/whmcs/verify`);
    assert.equal(blocked.status, 429);
    const json = await blocked.json();
    assert.equal(json.error, "Too many requests. Please slow down and try again shortly.");
    assert.ok(typeof json.retryAfterSeconds === "number" && json.retryAfterSeconds > 0);
    assert.ok(blocked.headers.get("retry-after"));

    for (let i = 0; i < 30; i++) {
      const r = await postJson(`${url}/whmcs/verify-admin`);
      assert.equal(r.status, 200, `admin verify attempt ${i + 1} should never be limited`);
    }
  } finally {
    await close();
  }
});

// ---------- Real bypassRateLimitForAdmins middleware (DB-lookup branch) ----------

// Sets only req.session.userId — unlike withSession it never sets
// req.skipRateLimit, so the real bypass middleware must make the decision
// itself via its storage.getUser lookup.
function withSessionUserId(userId?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).session = userId ? { userId } : {};
    next();
  };
}

// Swaps storage.getUser for the duration of a test, restoring it afterwards.
async function withStubbedGetUser(
  impl: (id: string) => Promise<User | undefined>,
  run: () => Promise<void>,
) {
  const original = storage.getUser;
  (storage as any).getUser = (id: string) => impl(id);
  try {
    await run();
  } finally {
    (storage as any).getUser = original;
  }
}

function fakeUser(role: Role, id: string): User {
  return { id, role } as unknown as User;
}

test("bypassRateLimitForAdmins: admin from a real session is not throttled past the budget", async () => {
  await withStubbedGetUser(
    async (id) => fakeUser("admin", id),
    async () => {
      const { url, close } = await startApp((app) => {
        app.post(
          "/whmcs/request",
          withSessionUserId("admin-real-1"),
          bypassRateLimitForAdmins,
          createWhmcsLinkRequestLimiter(),
          (_req, res) => res.json({ ok: true }),
        );
      });
      try {
        // Budget is 5; an admin should sail well past it via the DB-lookup bypass.
        for (let i = 0; i < 20; i++) {
          const r = await postJson(`${url}/whmcs/request`);
          assert.equal(r.status, 200, `admin attempt ${i + 1} should never be limited`);
        }
      } finally {
        await close();
      }
    },
  );
});

test("bypassRateLimitForAdmins: master_admin from a real session is not throttled past the budget", async () => {
  await withStubbedGetUser(
    async (id) => fakeUser("master_admin", id),
    async () => {
      const { url, close } = await startApp((app) => {
        app.post(
          "/whmcs/verify",
          withSessionUserId("admin-real-2"),
          bypassRateLimitForAdmins,
          createWhmcsLinkVerifyLimiter(),
          (_req, res) => res.json({ ok: true }),
        );
      });
      try {
        // Budget is 15; a master_admin should pass it freely.
        for (let i = 0; i < 30; i++) {
          const r = await postJson(`${url}/whmcs/verify`);
          assert.equal(r.status, 200, `master_admin attempt ${i + 1} should never be limited`);
        }
      } finally {
        await close();
      }
    },
  );
});

test("bypassRateLimitForAdmins: a customer from a real session is still throttled", async () => {
  await withStubbedGetUser(
    async (id) => fakeUser("customer", id),
    async () => {
      const { url, close } = await startApp((app) => {
        app.post(
          "/whmcs/request",
          withSessionUserId("customer-real-1"),
          bypassRateLimitForAdmins,
          createWhmcsLinkRequestLimiter(),
          (_req, res) => res.json({ ok: true }),
        );
      });
      try {
        for (let i = 0; i < 5; i++) {
          const r = await postJson(`${url}/whmcs/request`);
          assert.equal(r.status, 200, `customer attempt ${i + 1} should still be allowed`);
        }
        const blocked = await postJson(`${url}/whmcs/request`);
        assert.equal(blocked.status, 429, "customer must be throttled past the budget");
      } finally {
        await close();
      }
    },
  );
});

test("bypassRateLimitForAdmins: a failed getUser lookup does not block the request and the limiter still applies", async () => {
  let lookups = 0;
  await withStubbedGetUser(
    async () => {
      lookups++;
      throw new Error("db down");
    },
    async () => {
      const { url, close } = await startApp((app) => {
        app.post(
          "/whmcs/request",
          withSessionUserId("user-when-db-down"),
          bypassRateLimitForAdmins,
          createWhmcsLinkRequestLimiter(),
          (_req, res) => res.json({ ok: true }),
        );
      });
      try {
        // The thrown lookup is swallowed best-effort: requests still flow,
        // but without a bypass the limiter throttles past the budget.
        for (let i = 0; i < 5; i++) {
          const r = await postJson(`${url}/whmcs/request`);
          assert.equal(r.status, 200, `attempt ${i + 1} should still be served despite the lookup error`);
        }
        const blocked = await postJson(`${url}/whmcs/request`);
        assert.equal(blocked.status, 429, "limiter must still apply when the bypass lookup fails");
        assert.ok(lookups > 0, "the failing getUser branch must actually be exercised");
      } finally {
        await close();
      }
    },
  );
});

test("whmcs link limiters: separate user buckets do not interfere", async () => {
  const { url, close } = await startApp((app) => {
    const requestLimiter = createWhmcsLinkRequestLimiter();
    app.post(
      "/whmcs/request-u1",
      withSession("customer", "user-W3"),
      requestLimiter,
      (_req, res) => res.json({ ok: true }),
    );
    app.post(
      "/whmcs/request-u2",
      withSession("customer", "user-W4"),
      requestLimiter,
      (_req, res) => res.json({ ok: true }),
    );
  });
  try {
    for (let i = 0; i < 5; i++) {
      const r = await postJson(`${url}/whmcs/request-u1`);
      assert.equal(r.status, 200);
    }
    const blocked = await postJson(`${url}/whmcs/request-u1`);
    assert.equal(blocked.status, 429);
    // A different user still has their full budget.
    const otherUser = await postJson(`${url}/whmcs/request-u2`);
    assert.equal(otherUser.status, 200);
  } finally {
    await close();
  }
});
