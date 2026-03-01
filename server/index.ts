import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { seedEmailTemplates, renderTemplate, sendEmail } from "./email";
import { storage } from "./storage";

const app = express();
const httpServer = createServer(app);

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
        });

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
})();
