import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, getWebSocketServer } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { seedEmailTemplates, renderTemplate, sendEmail } from "./email";
import { storage } from "./storage";
import { logError } from "./error-log";
import { userWantsChannel } from "@shared/notification-categories";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { APP_VERSION } from "@shared/version";
import { runMigrations } from "./migrate";

const app = express();
const httpServer = createServer(app);

const PROCESS_START_MS = Date.now();

// Resolve the git SHA of the running build ONCE at boot. Priority:
//   1. dist/.git-sha   (written by `npm run build`, the production path)
//   2. .git-sha        (root-level fallback)
//   3. `git rev-parse HEAD` (dev only — fast, but shells out)
//   4. null            (unknown — health endpoint will report null, deploy
//                       script will treat that as a hard fail)
function resolveGitSha(): string | null {
  const candidates = [
    join(process.cwd(), "dist", ".git-sha"),
    join(process.cwd(), ".git-sha"),
  ];
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const sha = readFileSync(p, "utf-8").trim();
        if (sha) return sha;
      }
    } catch {}
  }
  try {
    return execSync("git rev-parse HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}
const GIT_SHA: string | null = resolveGitSha();

app.get("/api/health", async (_req, res) => {
  let dbStatus: "ok" | "down" = "down";
  let migrationsApplied: number | null = null;
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = "ok";
    try {
      const result = await db.execute<{ c: number }>(
        sql`SELECT COUNT(*)::int AS c FROM "drizzle"."__drizzle_migrations"`,
      );
      const rows = Array.isArray(result) ? result : result.rows;
      const first = rows?.[0];
      if (first && typeof first.c === "number") migrationsApplied = first.c;
    } catch {
      migrationsApplied = null;
    }
  } catch {
    dbStatus = "down";
  }
  const ok = dbStatus === "ok";
  res.status(ok ? 200 : 503).json({
    ok,
    db: dbStatus,
    version: APP_VERSION,
    gitSha: GIT_SHA,
    uptime: Math.floor((Date.now() - PROCESS_START_MS) / 1000),
    migrationsApplied,
  });
});

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

app.get("/sw.js", (_req, res, next) => {
  res.setHeader("Service-Worker-Allowed", "/");
  res.setHeader("Content-Type", "application/javascript");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Cap the embedded body. PM2's log file splits any single console.log
        // longer than ~1KB across multiple physical lines, and only the first
        // chunk carries the `[express]` prefix. The deploy log-tail error
        // gate filters on `[express]` to skip request logs — continuation
        // chunks slip through, and routes that return large JSON arrays
        // containing strings like `column "x" does not exist` (e.g. the
        // admin error-history endpoint) end up tripping the gate on perfectly
        // healthy deploys. 200 chars is plenty for at-a-glance debugging
        // and keeps the whole log line well under pm2's split threshold.
        const body = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${body.length > 200 ? body.slice(0, 200) + "…" : body}`;
      }

      log(logLine);

      // Backstop 5xx capture: many routes do `res.status(500).json(...)`
      // directly instead of `next(err)`, which bypasses the express error
      // handler below (and therefore bypasses the error_logs insert that
      // the fallback alerter polls). This finish hook fires AFTER the
      // response is sent for every API request, so any 5xx — no matter
      // how the route emitted it — gets recorded exactly once here.
      if (res.statusCode >= 500) {
        try {
          logError("route", new Error(`${req.method} ${path} → ${res.statusCode}`), {
            severity: "error",
            userId: (req as any)?.session?.userId ?? null,
            summary: `${req.method} ${path} → ${res.statusCode}`.slice(0, 500),
            extra: { method: req.method, path, status: res.statusCode, body: capturedJsonResponse },
          });
        } catch {}
      }
    }
  });

  next();
});

(async () => {
  await runMigrations();
  await registerRoutes(httpServer, app);

  // Start the in-app alerter. Polls error_logs every 60s and posts to the
  // alert Discord channel on fatal errors or 5xx bursts.
  const { startErrorAlerter } = await import("./error-alerter");
  startErrorAlerter();

  async function pruneOldErrorLogs() {
    try {
      const removed = await storage.deleteOldErrorLogs(30);
      if (removed > 0) console.log(`[ErrorLog] Pruned ${removed} log(s) older than 30 days`);
    } catch (e) {
      console.error("[ErrorLog] Retention prune error:", e);
    }
  }
  setTimeout(() => pruneOldErrorLogs(), 30000);
  setInterval(() => pruneOldErrorLogs(), 24 * 60 * 60 * 1000);

  try {
    await seed();
  } catch (e) {
    console.error("Seed error:", e);
  }

  try {
    await seedEmailTemplates();
  } catch (e) {
    console.error("Email template seed error:", e);
  }

  // One-time import of legacy CHANGELOG.md into changelog_entries. Idempotent;
  // a no-op on subsequent boots once every section already has a row.
  try {
    const { seedChangelogEntries } = await import("../script/seed-changelog");
    const r = await seedChangelogEntries();
    if (r.inserted > 0) log(`Changelog seed: imported ${r.inserted}, skipped ${r.skipped}`);
  } catch (e) {
    console.error("Changelog seed error:", e);
  }

  // Auto-create an empty draft row for the current APP_VERSION the moment a
  // new build boots, so the admin portal's Changelog tab always has a row
  // ready to write into. The popup stays silent until master_admin clicks
  // Publish on this row.
  try {
    const existing = await storage.getChangelogEntry(APP_VERSION);
    if (!existing) {
      await storage.createChangelogEntry({
        version: APP_VERSION,
        title: "",
        bodyHtml: "",
        status: "draft",
        publishedAt: null,
        publishedBy: null,
      });
      log(`Changelog: created draft row for version ${APP_VERSION}`);
    }
  } catch (e) {
    console.error("Changelog auto-draft error:", e);
  }

  async function checkSetupReminders() {
    try {
      const allUsers = await storage.getAllUsers();
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

      for (const user of allUsers) {
        if (user.role !== "customer") continue;
        if (user.setupReminderEmailSent) continue;
        if (!user.createdAt || new Date(user.createdAt) > twoDaysAgo) continue;

        const pushSubs = await storage.getPushSubscriptionsByUser(user.id);
        const hasPush = pushSubs.length > 0;
        const hasServices = (user.subscribedServices?.length ?? 0) > 0;

        if (hasPush && hasServices) {
          await storage.updateUser(user.id, { setupReminderEmailSent: true });
          continue;
        }

        const wantsReminder = userWantsChannel(
          user.notificationPrefs,
          "setup_reminder",
          "email",
        );
        if (!wantsReminder) {
          await storage.updateUser(user.id, { setupReminderEmailSent: true });
          continue;
        }

        const missingItems: string[] = [];
        if (!hasPush) {
          missingItems.push("<p><strong>Enable push notifications</strong> — Without push notifications, you won't receive instant alerts when service issues arise or when your support tickets are updated.</p>");
        }
        if (!hasServices) {
          missingItems.push("<p><strong>Select your services</strong> — Without selecting the services relevant to you, you won't be notified when new service issues arise or be able to fully take advantage of the many features the app provides regarding your service.</p>");
        }

        const rendered = await renderTemplate("customer_setup_reminder", {
          customer_name: user.fullName,
          missing_items: missingItems.join("\n"),
        }, new Set(["missing_items"]));

        if (rendered && user.email) {
          await sendEmail(user.email, rendered.subject, rendered.body);
          log(`Setup reminder email sent to ${user.email}`);
        }

        await storage.updateUser(user.id, { setupReminderEmailSent: true });
      }
    } catch (err) {
      console.error("Setup reminder check error:", err);
    }
  }

  setTimeout(() => checkSetupReminders(), 10000);
  setInterval(() => checkSetupReminders(), 60 * 60 * 1000);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (status >= 500) {
      try {
        logError("route", err, {
          severity: "error",
          userId: (req as any)?.session?.userId ?? null,
          summary: `${req.method} ${req.path} → ${status}: ${message}`.slice(0, 500),
          extra: { method: req.method, path: req.path, status },
        });
      } catch {}
    }

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${signal}, shutting down gracefully...`);
    const forceExit = setTimeout(() => {
      log("forced exit after 10s shutdown timeout");
      process.exit(1);
    }, 10000);
    forceExit.unref();
    // 1) stop accepting new HTTP/WS connections
    httpServer.close(async (err) => {
      if (err) {
        log(`httpServer close error: ${err.message}`);
      }
      try {
        await pool.end();
        log("postgres pool drained");
      } catch (e: any) {
        log(`pool end error: ${e?.message ?? e}`);
      }
      clearTimeout(forceExit);
      process.exit(0);
    });

    // 2) explicitly close the WebSocket server and existing clients —
    //    httpServer.close() alone does NOT terminate already-connected
    //    WebSockets, which would block close() from completing.
    const wss = getWebSocketServer();
    if (wss) {
      try {
        wss.clients.forEach((ws) => {
          try { ws.close(1001, "server shutting down"); } catch {}
        });
        // Hard-terminate any client that hasn't acknowledged in 5s.
        const wsForce = setTimeout(() => {
          wss.clients.forEach((ws) => {
            try { ws.terminate(); } catch {}
          });
        }, 5000);
        wsForce.unref();
        wss.close((wsErr) => {
          if (wsErr) log(`wss close error: ${wsErr.message}`);
          else log("websocket server closed");
        });
      } catch (e: any) {
        log(`wss shutdown error: ${e?.message ?? e}`);
      }
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
