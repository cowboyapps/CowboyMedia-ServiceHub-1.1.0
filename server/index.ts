import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes, getWebSocketServer, sendPushToUser, sendTemplatedEmail, customerWantsPush, customerWantsEmail, broadcastToUserIds } from "./routes";
import { hasWhmcsCredentials, normalizeBaseUrl as normalizeWhmcsBaseUrl } from "./whmcs";
import { loadTicketsList as loadWhmcsTicketsList } from "./whmcs-tickets";
import { startWhmcsTicketNotifier, type NotifierUser, type NotifierTicket } from "./whmcs-ticket-notifier";
import {
  whmcsTicketPath,
  whmcsTicketUrl,
  ticketNotifTitle,
  ticketNotifBody,
  TICKET_REPLY_TEMPLATE_KEY,
} from "@shared/whmcs-notify";
import {
  loadInvoicesList as loadWhmcsInvoicesList,
  loadServicesList as loadWhmcsServicesList,
  buildServiceUrl as buildWhmcsServiceUrl,
} from "./whmcs-billing";
import {
  startWhmcsInvoiceNotifier,
  type InvoiceNotifierUser,
  type NotifierInvoice,
} from "./whmcs-invoice-notifier";
import {
  invoiceNotifTitle,
  invoiceNotifBody,
  invoiceLabel,
  invoiceAmountLabel,
  invoiceDuePhrase,
  invoiceTemplateKey,
  type InvoiceStageMap,
} from "@shared/whmcs-invoice-notify";
import {
  startWhmcsServiceNotifier,
  type ServiceNotifierUser,
  type NotifierService,
} from "./whmcs-service-notifier";
import {
  serviceNotifTitle,
  serviceNotifBody,
  serviceLabel,
  serviceRenewPhrase,
  serviceTemplateKey,
  SERVICE_READY_TEMPLATE_KEY,
  serviceReadyTitle,
  serviceReadyBody,
  SERVICE_ADDED_TEMPLATE_KEY,
  serviceAddedTitle,
  serviceAddedBody,
} from "@shared/whmcs-service-notify";
import { serveStatic } from "./static";
import { createServer } from "http";
import { seed } from "./seed";
import { seedEmailTemplates, renderTemplate, sendEmail } from "./email";
import { seedNotificationTemplates, getNotificationOverride } from "./notification-templates-store";
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
import { buildApiLogLine } from "./request-log";

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

// Serve /sw.js with the correct Content-Type only. Do NOT set
// Service-Worker-Allowed or Cache-Control here: on production the nginx
// `location = /sw.js` block already sets both (deploy/nginx.conf.template). When
// Express ALSO sets them the response carries each header TWICE, and iOS/WebKit
// hard-fails service-worker registration on a duplicated Service-Worker-Allowed
// (folded to "/, /") with:
//   SecurityError: Scope URL should start with the given script URL
// even though /sw.js itself is served cleanly. Chrome tolerates the duplicate,
// so this only ever broke iPhones — and only in production (no nginx in dev). The
// worker lives at the site root, so its default scope is already "/" and no
// allow-header is strictly required; nginx remains the single source of it.
app.get("/sw.js", (_req, res, next) => {
  res.setHeader("Content-Type", "application/javascript");
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
      // Routes whose JSON body carries sensitive customer data (e.g. WHMCS
      // service login passwords from "My Services") never have their body
      // embedded in the request log, even truncated. The decision + the
      // 200-char body cap live in server/request-log.ts so both are covered by
      // server/request-log.test.ts (importing this file in a test would boot
      // the whole server).
      const logLine = buildApiLogLine({
        method: req.method,
        path,
        statusCode: res.statusCode,
        durationMs: duration,
        body: capturedJsonResponse,
      });

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

// Boot-time DB retry: a database that is briefly unreachable (restarting
// during unattended upgrades, VPS reboot ordering, etc.) must NOT make the
// app give up — PM2 exhausts its restart budget within a minute and the site
// then stays down until a human intervenes. Retry connection-level failures
// with backoff for up to ~5 minutes before letting the process die.
// Real migration failures (SQL errors, schema drift) are NOT retried.
const RETRYABLE_DB_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH",
  "57P03", // cannot_connect_now: postgres is starting up / shutting down
  "53300", // too_many_connections
]);

function isRetryableDbError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; errors?: Array<{ code?: string }> } | undefined;
  if (!e) return false;
  if (e.code && RETRYABLE_DB_CODES.has(e.code)) return true;
  // pg's pool connect timeout (connectionTimeoutMillis) rejects with a plain
  // Error carrying no code — match its message.
  if (typeof e.message === "string" && /timeout exceeded when trying to connect/i.test(e.message)) return true;
  // AggregateError from net.connect (e.g. IPv4+IPv6 both refused)
  return Array.isArray(e.errors) && e.errors.some((s) => s?.code && RETRYABLE_DB_CODES.has(s.code));
}

async function runMigrationsWithRetry(): Promise<void> {
  const deadline = Date.now() + 5 * 60 * 1000;
  let delayMs = 2000;
  for (;;) {
    try {
      await runMigrations();
      return;
    } catch (err) {
      if (!isRetryableDbError(err) || Date.now() + delayMs > deadline) throw err;
      console.error(
        `[boot] database unreachable (${(err as { code?: string }).code ?? "unknown"}), retrying in ${Math.round(delayMs / 1000)}s...`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
}

void (async () => {
  await runMigrationsWithRetry();
  await registerRoutes(httpServer, app);

  // Start the in-app alerter. Polls error_logs every 60s and posts to the
  // alert Discord channel on fatal errors or 5xx bursts.
  const { startErrorAlerter } = await import("./error-alerter");
  startErrorAlerter();

  // Notify customers (push + email) when one of their mirrored WHMCS billing
  // tickets gets a staff reply. Polls linked customers; no-ops when WHMCS is
  // unconfigured/disabled. De-dupes via a per-ticket server-side marker.
  startWhmcsTicketNotifier({
    getConfig: async () => {
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const active = hasWhmcsCredentials() && !!baseUrl && !!settings?.enabled;
      return { active, baseUrl };
    },
    getLinkedUsers: async () => {
      const all = await storage.getAllUsers();
      return all.filter((u) => u.whmcsClientId != null) as unknown as NotifierUser[];
    },
    loadTickets: async (clientId, baseUrl) => {
      const list = await loadWhmcsTicketsList(clientId, baseUrl);
      return {
        tickets: list.tickets.map((t) => ({
          id: t.id,
          statusKey: t.statusKey,
          lastReply: t.lastReply,
          tid: t.tid,
          subject: t.subject,
        })) as NotifierTicket[],
        unreachable: list.unreachable,
      };
    },
    getNotifyState: (userId) => storage.getWhmcsTicketNotifyState(userId),
    recordNotified: (userId, ticketId, date) => storage.recordWhmcsTicketNotified(userId, ticketId, date),
    createInApp: async (user, ticket) => {
      // Decoupled from push (Task #350) so email-only customers still get a
      // bell entry. Never throws — a failure here must not abort the pass.
      try {
        const ov = await getNotificationOverride(TICKET_REPLY_TEMPLATE_KEY);
        const row = await storage.createUserNotification({
          userId: user.id,
          type: "whmcs_ticket_reply",
          title: ticketNotifTitle(ov),
          body: ticketNotifBody(ticket.subject, ov),
          referenceType: "whmcs_ticket",
          referenceId: String(ticket.id),
          url: whmcsTicketPath(ticket.id),
        });
        return row.id;
      } catch (e) {
        console.error("[whmcs-notifier] createInApp failed:", (e as Error)?.message);
        return null;
      }
    },
    sendPush: (user, ticket, notificationId) => {
      void (async () => {
        const ov = await getNotificationOverride(TICKET_REPLY_TEMPLATE_KEY);
        void sendPushToUser(
          user.id,
          {
            title: ticketNotifTitle(ov),
            body: ticketNotifBody(ticket.subject, ov),
            url: whmcsTicketPath(ticket.id),
            tag: `whmcs-ticket-${ticket.id}`,
            resourceLabel: `Billing ticket: ${ticket.subject || ticket.id}`,
            rollupNoun: "replies",
          },
          // Reuse the already-created bell row so push users get exactly one;
          // fall back to creating one in sendPushToUser if createInApp failed.
          notificationId
            ? { notificationId }
            : { type: "whmcs_ticket_reply", referenceType: "whmcs_ticket", referenceId: String(ticket.id) },
        );
      })();
    },
    sendEmail: (user, ticket) => {
      if (!user.email) return;
      // Email has no relative base, so deep-link with an absolute URL built
      // from APP_BASE_URL (falls back to localhost in dev). Mirrors the
      // password-reset link-building convention in routes.ts.
      const base = (process.env.APP_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
      void sendTemplatedEmail(
        user.email,
        "customer_whmcs_ticket_reply",
        {
          ticket_subject: ticket.subject || "your billing ticket",
          customer_name: user.fullName,
          ticket_url: whmcsTicketUrl(base, ticket.id),
        },
        user.fullName,
      );
    },
    wantsPush: (user, categoryKey) => customerWantsPush(user as any, categoryKey),
    wantsEmail: (user, categoryKey) => customerWantsEmail(user as any, categoryKey),
  });

  // Notify customers (push + email + bell) as one of their unpaid WHMCS
  // invoices nears its due date, and again once it goes overdue, with a one-tap
  // action that opens the WHMCS payment page for that invoice. Polls linked
  // customers; no-ops when WHMCS is unconfigured/disabled; de-dupes via a
  // per-invoice STAGE marker. Degrades cleanly (no marker writes, no crash)
  // while the WHMCS API role still lacks the GetInvoices permission — every
  // list comes back unreachable and nothing is recorded.
  startWhmcsInvoiceNotifier({
    getConfig: async () => {
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const active = hasWhmcsCredentials() && !!baseUrl && !!settings?.enabled;
      return { active, baseUrl };
    },
    getLinkedUsers: async () => {
      const all = await storage.getAllUsers();
      return all.filter((u) => u.whmcsClientId != null) as unknown as InvoiceNotifierUser[];
    },
    loadInvoices: async (clientId, baseUrl) => {
      const list = await loadWhmcsInvoicesList(clientId, baseUrl);
      return {
        invoices: list.invoices as unknown as NotifierInvoice[],
        unreachable: list.unreachable,
      };
    },
    getNotifyState: (userId) =>
      storage.getWhmcsInvoiceNotifyState(userId) as Promise<InvoiceStageMap>,
    recordNotified: (userId, invoiceId, stage) =>
      storage.recordWhmcsInvoiceNotified(userId, invoiceId, stage),
    createInApp: async (user, invoice, stage) => {
      // Decoupled from push so email-only customers still get a bell entry. The
      // bell row deep-links to the in-app /billing screen (not the external pay
      // page). Never throws — a failure here must not abort the pass.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const ov = await getNotificationOverride(invoiceTemplateKey(stage));
        const row = await storage.createUserNotification({
          userId: user.id,
          type: "whmcs_invoice_due",
          title: invoiceNotifTitle(stage, ov),
          body: invoiceNotifBody(invoice, stage, today, ov),
          referenceType: "whmcs_invoice",
          referenceId: String(invoice.id),
          url: "/billing",
        });
        return row.id;
      } catch (e) {
        console.error("[whmcs-invoice-notifier] createInApp failed:", (e as Error)?.message);
        return null;
      }
    },
    sendPush: (user, invoice, stage, notificationId) => {
      void (async () => {
        const today = new Date().toISOString().slice(0, 10);
        const ov = await getNotificationOverride(invoiceTemplateKey(stage));
        // PUSH deep-links straight to the WHMCS pay page (absolute, cross-origin)
        // so one tap opens checkout; the service worker opens it in its own window
        // rather than hijacking an open ServiceHub tab. Falls back to the in-app
        // /billing screen when WHMCS gave us no pay URL.
        const payUrl = invoice.payUrl || "/billing";
        void sendPushToUser(
          user.id,
          {
            title: invoiceNotifTitle(stage, ov),
            body: invoiceNotifBody(invoice, stage, today, ov),
            url: payUrl,
            tag: `whmcs-invoice-${invoice.id}`,
            resourceLabel: `Invoice ${invoiceLabel(invoice)}`,
            rollupNoun: "reminders",
          },
          // Reuse the already-created bell row so push users get exactly one;
          // fall back to creating one in sendPushToUser if createInApp failed.
          notificationId
            ? { notificationId }
            : { type: "whmcs_invoice_due", referenceType: "whmcs_invoice", referenceId: String(invoice.id) },
        );
      })();
    },
    sendEmail: (user, invoice, stage) => {
      if (!user.email) return;
      const today = new Date().toISOString().slice(0, 10);
      // Email has no relative base — build the in-app fallback link from
      // APP_BASE_URL (matches the ticket notifier / password-reset convention).
      const base = (process.env.APP_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
      void sendTemplatedEmail(
        user.email,
        "customer_whmcs_invoice_due",
        {
          invoice_num: invoiceLabel(invoice),
          invoice_amount: invoiceAmountLabel(invoice),
          due_phrase: invoiceDuePhrase(stage, today, invoice.dueDate),
          invoice_url: invoice.payUrl || `${base}/billing`,
          customer_name: user.fullName,
        },
        user.fullName,
      );
    },
    wantsPush: (user, categoryKey) => customerWantsPush(user as any, categoryKey),
    wantsEmail: (user, categoryKey) => customerWantsEmail(user as any, categoryKey),
    prefsOn: (user, categoryKey) => {
      // Channel prefs only, IGNORING quiet hours: did the customer enable push
      // or email for this category at all? Distinguishes "turned it off" (record
      // the marker so it won't replay later) from "quiet-hours suppressed it
      // right now" (skip the marker so the next post-quiet-hours pass retries).
      const prefs = (user as any).notificationPrefs;
      return (
        userWantsChannel(prefs, categoryKey, "push") || userWantsChannel(prefs, categoryKey, "email")
      );
    },
  });

  // Notify customers (push + email + bell) about WHMCS service-lifecycle events:
  // an active service approaching its renewal date, a service getting suspended,
  // and a service returning to active (unsuspended). Polls linked customers;
  // no-ops when WHMCS is unconfigured/disabled; de-dupes via a per-service marker
  // (last-seen status for the suspend/unsuspend edge; last-notified renewal date
  // so a renewal re-fires once per billing cycle). The first sighting of a
  // service is recorded SILENTLY so enabling the feature never storms customers
  // about pre-existing suspensions/renewals. Degrades cleanly (no marker writes,
  // no crash) while the WHMCS API role still lacks product-read permission —
  // every list comes back unreachable and nothing is recorded.
  startWhmcsServiceNotifier({
    getConfig: async () => {
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const active = hasWhmcsCredentials() && !!baseUrl && !!settings?.enabled;
      return { active, baseUrl };
    },
    getLinkedUsers: async () => {
      const all = await storage.getAllUsers();
      return all.filter((u) => u.whmcsClientId != null) as unknown as ServiceNotifierUser[];
    },
    loadServices: async (clientId) => {
      const list = await loadWhmcsServicesList(clientId);
      return {
        services: list.services as unknown as NotifierService[],
        unreachable: list.unreachable,
      };
    },
    getMarkers: (userId) => storage.getWhmcsServiceNotifyState(userId),
    recordMarker: (userId, serviceId, marker) =>
      storage.recordWhmcsServiceNotified(userId, serviceId, marker),
    createInApp: async (user, service, kind) => {
      // Decoupled from push so email-only customers still get a bell entry. The
      // bell row deep-links to the in-app /billing screen (not the external WHMCS
      // service page). Never throws — a failure here must not abort the pass.
      try {
        const today = new Date().toISOString().slice(0, 10);
        const ov = await getNotificationOverride(serviceTemplateKey(kind));
        const row = await storage.createUserNotification({
          userId: user.id,
          type: kind === "renewal" ? "whmcs_service_renewal" : "whmcs_service_status",
          title: serviceNotifTitle(kind, ov),
          body: serviceNotifBody(service, kind, today, ov),
          referenceType: "whmcs_service",
          referenceId: String(service.id),
          url: "/billing",
        });
        return row.id;
      } catch (e) {
        console.error("[whmcs-service-notifier] createInApp failed:", (e as Error)?.message);
        return null;
      }
    },
    sendPush: (user, service, kind, baseUrl, notificationId) => {
      void (async () => {
        const today = new Date().toISOString().slice(0, 10);
        const ov = await getNotificationOverride(serviceTemplateKey(kind));
        // Renewal + suspended PUSH deep-link to the WHMCS service page (absolute,
        // cross-origin) so one tap opens it; the service worker opens it in its own
        // window rather than hijacking an open ServiceHub tab. Unsuspended is
        // purely informational → the in-app /billing screen. Falls back to /billing
        // when WHMCS gave us no base URL.
        const serviceUrl = buildWhmcsServiceUrl(baseUrl, service.id);
        const url = kind === "unsuspended" ? "/billing" : serviceUrl || "/billing";
        void sendPushToUser(
          user.id,
          {
            title: serviceNotifTitle(kind, ov),
            body: serviceNotifBody(service, kind, today, ov),
            url,
            tag: `whmcs-service-${service.id}-${kind}`,
            resourceLabel: serviceLabel(service),
            rollupNoun: kind === "renewal" ? "reminders" : "updates",
          },
          // Reuse the already-created bell row so push users get exactly one; fall
          // back to creating one in sendPushToUser if createInApp failed.
          notificationId
            ? { notificationId }
            : {
                type: kind === "renewal" ? "whmcs_service_renewal" : "whmcs_service_status",
                referenceType: "whmcs_service",
                referenceId: String(service.id),
              },
        );
      })();
    },
    sendEmail: (user, service, kind, baseUrl) => {
      if (!user.email) return;
      const today = new Date().toISOString().slice(0, 10);
      // Email has no relative base — build the in-app fallback link from
      // APP_BASE_URL (matches the invoice / ticket notifier convention).
      const base = (process.env.APP_BASE_URL || "http://localhost:5000").replace(/\/+$/, "");
      const serviceUrl = buildWhmcsServiceUrl(baseUrl, service.id) || `${base}/billing`;
      const templateKey =
        kind === "renewal"
          ? "customer_whmcs_service_renewal"
          : kind === "suspended"
            ? "customer_whmcs_service_suspended"
            : "customer_whmcs_service_unsuspended";
      const vars: Record<string, string> = {
        service_name: serviceLabel(service),
        service_url: serviceUrl,
        customer_name: user.fullName,
      };
      if (kind === "renewal") vars.renew_phrase = serviceRenewPhrase(today, service.nextDueDate);
      void sendTemplatedEmail(user.email, templateKey, vars, user.fullName);
    },
    wantsPush: (user, categoryKey) => customerWantsPush(user as any, categoryKey),
    wantsEmail: (user, categoryKey) => customerWantsEmail(user as any, categoryKey),
    prefsOn: (user, categoryKey) => {
      const prefs = (user as any).notificationPrefs;
      return (
        userWantsChannel(prefs, categoryKey, "push") || userWantsChannel(prefs, categoryKey, "email")
      );
    },
    // --- "New service is ready" hooks (Task #474) -----------------------------
    getPendingOrders: (userId) =>
      storage
        .getUnfulfilledWhmcsPendingOrders(userId)
        .then((rows) => rows.map((r) => ({ id: r.id, whmcsProductId: r.whmcsProductId }))),
    markPendingOrderFulfilled: (orderId) => storage.markWhmcsPendingOrderFulfilled(orderId),
    createReadyInApp: async (user, service) => {
      // In-app is the PRIMARY channel for "ready" (fires regardless of push
      // prefs). The bell row deep-links to /my-services?service=<id> — the secure
      // surface where login details + DNS are shown, with the new service's card
      // auto-expanded. Strictly credential-free. Never throws: a failure here must
      // not abort the pass.
      try {
        const ov = await getNotificationOverride(SERVICE_READY_TEMPLATE_KEY);
        const row = await storage.createUserNotification({
          userId: user.id,
          type: "whmcs_service_ready",
          title: serviceReadyTitle(ov),
          body: serviceReadyBody(service, ov),
          referenceType: "whmcs_service",
          referenceId: String(service.id),
          url: `/my-services?service=${service.id}`,
        });
        return row.id;
      } catch (e) {
        console.error("[whmcs-service-notifier] createReadyInApp failed:", (e as Error)?.message);
        return null;
      }
    },
    sendReadyPush: (user, service, _baseUrl, notificationId) => {
      void (async () => {
        const ov = await getNotificationOverride(SERVICE_READY_TEMPLATE_KEY);
        // Deep-link to /my-services?service=<id> (the secure surface) so the new
        // service's card auto-expands. No credentials in the payload — only the
        // service name + a tap target.
        void sendPushToUser(
          user.id,
          {
            title: serviceReadyTitle(ov),
            body: serviceReadyBody(service, ov),
            url: `/my-services?service=${service.id}`,
            tag: `whmcs-service-${service.id}-ready`,
            resourceLabel: serviceLabel(service),
            rollupNoun: "updates",
          },
          notificationId
            ? { notificationId }
            : {
                type: "whmcs_service_ready",
                referenceType: "whmcs_service",
                referenceId: String(service.id),
              },
        );
      })();
    },
    // --- "New service added" hooks (Task #567) -------------------------------
    // Detects a service ordered directly in WHMCS (outside the ServiceHub store)
    // on its first sighting after the customer has been baselined.
    getServiceBaseline: (userId) => storage.getWhmcsServiceBaselined(userId),
    recordServiceBaseline: (userId) => storage.recordWhmcsServiceBaselined(userId),
    recordAddedAnnouncement: async (user, service) => {
      // Persist the one-time popup row (idempotent on (user, service)). Returns
      // false on failure so the notifier leaves the service unmarked + retries.
      try {
        return await storage.createWhmcsServiceAnnouncement(user.id, service.id, serviceLabel(service));
      } catch (e) {
        console.error("[whmcs-service-notifier] recordAddedAnnouncement failed:", (e as Error)?.message);
        return false;
      }
    },
    createAddedInApp: async (user, service) => {
      // In-app is a PRIMARY channel for "added" (fires regardless of push prefs).
      // Bell row deep-links to /my-services?service=<id> (the secure surface) so
      // the new service's card auto-expands. Credential-free. Never throws.
      try {
        const ov = await getNotificationOverride(SERVICE_ADDED_TEMPLATE_KEY);
        const row = await storage.createUserNotification({
          userId: user.id,
          type: "whmcs_service_added",
          title: serviceAddedTitle(ov),
          body: serviceAddedBody(service, ov),
          referenceType: "whmcs_service",
          referenceId: String(service.id),
          url: `/my-services?service=${service.id}`,
        });
        return row.id;
      } catch (e) {
        console.error("[whmcs-service-notifier] createAddedInApp failed:", (e as Error)?.message);
        return null;
      }
    },
    sendAddedPush: (user, service, _baseUrl, notificationId) => {
      void (async () => {
        const ov = await getNotificationOverride(SERVICE_ADDED_TEMPLATE_KEY);
        void sendPushToUser(
          user.id,
          {
            title: serviceAddedTitle(ov),
            body: serviceAddedBody(service, ov),
            url: `/my-services?service=${service.id}`,
            tag: `whmcs-service-${service.id}-added`,
            resourceLabel: serviceLabel(service),
            rollupNoun: "updates",
          },
          notificationId
            ? { notificationId }
            : {
                type: "whmcs_service_added",
                referenceType: "whmcs_service",
                referenceId: String(service.id),
              },
        );
      })();
    },
    broadcastAdded: (user, service) => {
      // Nudge the customer's open tabs so the popup surfaces without a reload.
      // Credential-free: only the service id + name + a message type.
      broadcastToUserIds([user.id], {
        type: "whmcs_service_added",
        serviceId: String(service.id),
        serviceName: serviceLabel(service),
      });
    },
  });

  async function pruneOldErrorLogs() {
    try {
      const removed = await storage.deleteOldErrorLogs(30);
      if (removed > 0) console.log(`[ErrorLog] Pruned ${removed} log(s) older than 30 days`);
    } catch (e) {
      console.error("[ErrorLog] Retention prune error:", e);
    }
  }
  setTimeout(() => void pruneOldErrorLogs(), 30000);
  setInterval(() => void pruneOldErrorLogs(), 24 * 60 * 60 * 1000);

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

  try {
    await seedNotificationTemplates();
  } catch (e) {
    console.error("Notification template seed error:", e);
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

  // Reconcile the rolling-draft changelog model (see
  // shared/changelog-rollover.ts). Guarantees exactly one open rolling draft
  // and, when the version number was bumped since the last boot, stamps the
  // collected notes with the new APP_VERSION (status "awaiting_publish") and
  // opens a fresh rolling draft. Idempotent on same-version reboots. The
  // popup stays silent until master_admin clicks Publish.
  try {
    const actions = await storage.ensureChangelogRollover(APP_VERSION);
    if (actions.adoptLegacyDraft) log(`Changelog: adopted legacy draft for v${APP_VERSION} as awaiting-publish`);
    if (actions.promoteRollingDraft) log(`Changelog: stamped collected notes as v${APP_VERSION}, awaiting publish`);
    if (actions.createRollingDraft) log(`Changelog: opened a fresh rolling draft`);
  } catch (e) {
    console.error("Changelog rollover error:", e);
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

  setTimeout(() => void checkSetupReminders(), 10000);
  setInterval(() => void checkSetupReminders(), 60 * 60 * 1000);

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
    httpServer.close((err) => {
      void (async () => {
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
      })();
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
