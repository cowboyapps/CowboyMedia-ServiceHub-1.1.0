import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, getWebSocketServer } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { seedEmailTemplates, renderTemplate, sendEmail } from "./email";
import { storage } from "./storage";
import { userWantsChannel } from "@shared/notification-categories";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

app.get("/api/health", async (_req, res) => {
  let dbStatus: "up" | "down" = "down";
  try {
    await db.execute(sql`SELECT 1`);
    dbStatus = "up";
  } catch (e) {
    dbStatus = "down";
  }
  const ok = dbStatus === "up";
  res.status(ok ? 200 : 503).json({ ok, db: dbStatus });
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
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  try {
    await db.execute(sql`ALTER TABLE ticket_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP`);
  } catch (e) {
    console.error("Migration error (ticket_messages.read_at):", e);
  }

  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_username TEXT`);
  } catch (e) {
    console.error("Migration error (users.chat_username):", e);
  }

  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_notifications TEXT DEFAULT 'mentions'`);
  } catch (e) {
    console.error("Migration error (users.chat_notifications):", e);
  }

  try {
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS chat_banned BOOLEAN DEFAULT FALSE`);
  } catch (e) {
    console.error("Migration error (users.chat_banned):", e);
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS community_messages (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      chat_username TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`);
  } catch (e) {
    console.error("Migration error (community_messages):", e);
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS community_reactions (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      message_id VARCHAR NOT NULL,
      user_id VARCHAR NOT NULL,
      emoji TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`);
  } catch (e) {
    console.error("Migration error (community_reactions):", e);
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS chat_word_filters (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      word TEXT NOT NULL UNIQUE,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`);
  } catch (e) {
    console.error("Migration error (chat_word_filters):", e);
  }

  try {
    await db.execute(sql`CREATE TABLE IF NOT EXISTS telegram_settings (
      id VARCHAR PRIMARY KEY DEFAULT 'singleton',
      chat_id TEXT,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    )`);
    await db.execute(sql`INSERT INTO telegram_settings (id, enabled) VALUES ('singleton', FALSE) ON CONFLICT (id) DO NOTHING`);
    await db.execute(sql`ALTER TABLE telegram_settings ADD COLUMN IF NOT EXISTS send_alerts BOOLEAN NOT NULL DEFAULT TRUE`);
    await db.execute(sql`ALTER TABLE telegram_settings ADD COLUMN IF NOT EXISTS send_service_updates BOOLEAN NOT NULL DEFAULT TRUE`);
    await db.execute(sql`ALTER TABLE telegram_settings ADD COLUMN IF NOT EXISTS send_news BOOLEAN NOT NULL DEFAULT TRUE`);
  } catch (e) {
    console.error("Migration error (telegram_settings):", e);
  }

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

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

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
