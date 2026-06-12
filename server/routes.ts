import type { Express, Request, Response, NextFunction } from "express";
import { type Server, ServerResponse } from "http";
import { storage } from "./storage";
import { registerAlertRoutes } from "./alert-routes";
import { canMutateInternalNote, canPostInternalNote, parseIsInternalFlag } from "./ticket-internal-notes";
import { resolveKbArticleAttachment, enrichKbArticlesForMessages, type KbArticleEnvelope } from "./community-chat-kb";
import { resolveKbAttachmentForSender } from "./message-attachments";
import { getParam } from "./http-params";
import { getCachedPublicStatus, setCachedPublicStatus } from "./public-status-cache";
import type { MonitorIncident } from "@shared/schema";
import { WebSocketServer, WebSocket } from "ws";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { db } from "./db";
import { uploadedFiles, newsStories, insertServiceUpdateSchema, insertDownloadSchema, insertUrlMonitorSchema, userNotifications, NEWS_REACTION_EMOJIS } from "@shared/schema";
import { deleteUploadedFileIfUnreferenced, sweepOrphanedUploadedFiles } from "./uploaded-file-cleanup";
import { getErrorMessage, getErrorStatusCode, getErrorName, getErrorCode } from "./error-utils";
import { queryString, queryInt } from "./request-utils";
import { createBusinessHoursHandlers } from "./business-hours";
import { createSupportAwayHandlers, computeSupportAwayStatus } from "./support-away";
import { createDashboardHandler } from "./dashboard";
import { createTelegramSettingsHandlers } from "./telegram-settings";
import { createDiscordSettingsHandlers } from "./discord-settings";
import { createWhmcsSettingsHandlers } from "./whmcs-settings";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl as normalizeWhmcsBaseUrl,
  testConnection as testWhmcsConnection,
  searchClients as searchWhmcsClients,
  getClientById as getWhmcsClientById,
  getClientByEmail as getWhmcsClientByEmail,
  listProducts as listWhmcsProducts,
  getClientProducts as getWhmcsClientProducts,
  normalizeListField as normalizeWhmcsListField,
  addTicketReplyAsClient as addWhmcsTicketReplyAsClient,
  addTicketReplyAsAdmin as addWhmcsTicketReplyAsAdmin,
  getTicketAttachment as getWhmcsTicketAttachment,
  getInvoicePdf as getWhmcsInvoicePdf,
  type TicketAttachmentUpload as WhmcsTicketAttachmentUpload,
} from "./whmcs";
import { loadBillingSummary, loadBillingDashboard, loadInvoiceDetail, parseProduct as parseWhmcsProduct, deriveMappedServiceIds } from "./whmcs-billing";
import { createCustomerInvoiceDetailHandler, createAdminInvoiceDetailHandler } from "./whmcs-invoice-detail-route";
import { createGetProfileHandler, createUpdateProfileHandler } from "./whmcs-profile-route";
import {
  loadTicketsList as loadWhmcsTicketsList,
  loadTicketDetail as loadWhmcsTicketDetail,
  bustTicketsListCache as bustWhmcsTicketsListCache,
  findTicketAttachment as findWhmcsTicketAttachment,
  type AttachmentOwnerType as WhmcsAttachmentOwnerType,
} from "./whmcs-tickets";
import { createTicketCategoryHandlers } from "./ticket-categories";
import { createKbAdminHandlers } from "./kb-admin";
import { createAdminRoleHandlers } from "./admin-roles";
import { createQuickResponseHandlers } from "./quick-responses";
import { z } from "zod";
import { eq, isNotNull, isNull, and, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";
import webpush from "web-push";
import { sendEmail, sendEmailToMultiple, renderTemplate, getDefaultTemplate } from "./email";
import { NOTIFICATION_TEMPLATE_DEFS } from "@shared/notification-templates";
import { invalidateNotificationTemplateCache } from "./notification-templates-store";
import { format } from "date-fns";
import sanitizeHtml from "sanitize-html";
import { fireTelegram, fireTelegramMany, sendTelegramTestMessage, composeServiceUpdate, composeNews } from "./telegram";
import {
  fireDiscord,
  fireDiscordMany,
  sendDiscordTestMessage,
  composeServiceUpdate as composeDiscordServiceUpdate,
  composeNews as composeDiscordNews,
  composeDiscordTest,
  type DiscordPayload,
} from "./discord";
import { insertAnnouncementSchema, updateAnnouncementSchema, type UpdateAnnouncement, updateProfileSchema, insertChangelogEntrySchema, type InsertChangelogEntry } from "@shared/schema";
import { appendBulletToBody, isBulletHeading } from "@shared/changelog-append";
import { APP_VERSION } from "@shared/version";
import { requireAgentToken } from "./agent-auth";
import { computeUserBadges, computeAccountAgeDays } from "@shared/badges";
import { isAllowedAnnouncementPath } from "@shared/announcement-routes";
import { selectVersionWelcome } from "@shared/version-welcome";
import { userWantsChannel, NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_KEYS, isCategoryVisibleToRole, getNotificationCategory, type NotificationPrefs, type AppRole } from "@shared/notification-categories";
import { shouldSuppressNotification } from "@shared/quiet-hours";
import { updateQuietHoursSchema } from "@shared/schema";
import { selectNewsPushRecipients, selectNewsEmailRecipients, selectNewsInAppRecipients } from "./news-recipients";
import { buildPushPayload } from "./push-payload";
import type { User, Service } from "@shared/schema";
import { suggestQuickResponses, checkAiDraftRateLimit, isAiDraftEnabled, buildAiPrompt } from "./suggestions";
import { markGroupRead } from "./notifications-helpers";
import { getOpenAIClient } from "./openai-client";
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
import { logError } from "./error-log";
import { createSearchHandler } from "./search";
import { ChallengeStore } from "./totp";
import { registerAuth2FARoutes } from "./totp-routes";
import {
  parseUserAgent,
  deviceLabel,
  getSessionsForUser,
  deleteSession as deleteSessionRow,
  deleteSessionsForUser,
  createPresenceMap,
} from "./sessions";

const totpChallenges = new ChallengeStore();
setInterval(() => totpChallenges.sweepExpired(), 60_000).unref?.();

function sanitizeUser<T extends { password?: string; emailNotifications?: boolean; totpSecret?: string | null }>(user: T) {
  const { password: _p, emailNotifications: _e, totpSecret: _t, ...safe } = user as any;
  return safe;
}

function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

type NotifUser = Pick<User, "role" | "notificationPrefs"> & Partial<Pick<User, "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd" | "quietHoursTimezone" | "quietHoursAllowCritical">>;

export function customerWantsPush(user: NotifUser | null | undefined, categoryKey: string, severity?: string | null): boolean {
  if (!user) return false;
  if (!userWantsChannel(user.notificationPrefs as NotificationPrefs | null | undefined, categoryKey, "push")) return false;
  if (shouldSuppressNotification({ user, categoryKey, severity })) return false;
  return true;
}

export function customerWantsEmail(user: NotifUser | null | undefined, categoryKey: string, severity?: string | null): boolean {
  if (!user) return false;
  if (!userWantsChannel(user.notificationPrefs as NotificationPrefs | null | undefined, categoryKey, "email")) return false;
  if (shouldSuppressNotification({ user, categoryKey, severity })) return false;
  return true;
}

// In-app bell cards honour only the per-category in_app pref. Unlike push/email
// they are NOT silenced by quiet hours — the bell is a passive surface the user
// pulls open on their own schedule, so a card should always be waiting there.
export function customerWantsInApp(user: NotifUser | null | undefined, categoryKey: string): boolean {
  if (!user) return false;
  return userWantsChannel(user.notificationPrefs as NotificationPrefs | null | undefined, categoryKey, "in_app");
}

function adminWantsPush(user: NotifUser | null | undefined, categoryKey: string, severity?: string | null): boolean {
  if (!user) return false;
  if (user.role !== "admin" && user.role !== "master_admin") return false;
  const cat = getNotificationCategory(categoryKey);
  if (!cat) return false;
  if (!isCategoryVisibleToRole(cat, user.role as AppRole)) return false;
  if (!userWantsChannel(user.notificationPrefs as NotificationPrefs | null | undefined, categoryKey, "push")) return false;
  if (shouldSuppressNotification({ user, categoryKey, severity })) return false;
  return true;
}

const sanitizeNewsContent = (html: string): string =>
  sanitizeHtml(html, {
    allowedTags: ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"],
    allowedAttributes: {
      "*": ["style"],
      img: ["src", "alt", "width", "height"],
      a: ["href", "target", "rel"],
    },
    allowedStyles: {
      "*": {
        "text-align": [/^left$/, /^center$/, /^right$/, /^justify$/],
        color: [/^#[0-9a-fA-F]{3,6}$/, /^rgb\(/, /^rgba\(/],
      },
    },
  });

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const scryptAsync = promisify(crypto.scrypt);

async function notifyServiceSubscribers(
  serviceId: string,
  event: "status" | "incident" | "resolved",
  vars: { service_name: string; alert_title: string; alert_description?: string; impact_label?: string; resolve_message?: string },
  baseUrl: string,
): Promise<void> {
  try {
    const subs = await storage.getConfirmedSubscribersForService(serviceId);
    const tplKey = event === "resolved" ? "subscriber_resolved" : "subscriber_incident";
    for (const sub of subs) {
      if (!sub.events?.includes(event)) continue;
      const unsubscribeLink = `${baseUrl}/api/public/unsubscribe?token=${encodeURIComponent(sub.unsubscribeToken)}`;
      sendTemplatedEmail(
        sub.email,
        tplKey,
        {
          service_name: vars.service_name,
          alert_title: vars.alert_title,
          alert_description: vars.alert_description || "",
          impact_label: vars.impact_label || "",
          resolve_message: vars.resolve_message || "",
          status_link: `${baseUrl}/status`,
          unsubscribe_link: unsubscribeLink,
        },
      ).catch(() => {});
    }
  } catch (e) {
    console.error("[notifyServiceSubscribers]", e);
  }
}

// Parse a serviceIds payload that may arrive as a JS array, a JSON string, or
// a comma-separated string (multipart/form-data submits everything as strings).
function parseServiceIds(raw: any): string[] {
  if (Array.isArray(raw)) return Array.from(new Set(raw.filter((v) => typeof v === "string" && v)));
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return Array.from(new Set(parsed.filter((v) => typeof v === "string" && v)));
    } catch { /* not JSON, fall through to CSV */ }
    return Array.from(new Set(raw.split(",").map((s) => s.trim()).filter(Boolean)));
  }
  return [];
}

// Fan a single Discord alert payload out to every covered service's webhook,
// deduplicated by URL. Services with a per-service override post to that
// override; the global webhook fires once if any covered service has no override
// (or there are no services at all).
function fireDiscordForServices(coveredServices: Service[], payload: DiscordPayload): void {
  // Resolve every covered service to its effective webhook (per-service override
  // or the global webhook), then dedup by final URL so the same endpoint never
  // receives the same alert twice — including the case where an override URL
  // happens to equal the global webhook URL.
  void (async () => {
    try {
      const settings = await storage.getDiscordSettings();
      const globalUrl = settings?.webhookUrl?.trim() || null;
      const targets = new Set<string>();
      for (const s of coveredServices) {
        const url = (s.discordWebhookUrl && s.discordWebhookUrl.trim()) || globalUrl;
        if (url) targets.add(url);
      }
      if (coveredServices.length === 0 && globalUrl) targets.add(globalUrl);
      for (const url of Array.from(targets)) fireDiscord(payload, "alert", url);
    } catch (e) {
      console.error("[Discord] fireDiscordForServices error:", e);
    }
  })();
}

// Per-IP rate limiter for public subscribe endpoint (5 / minute).
const subscribeRateLimit = new Map<string, number[]>();
function checkSubscribeRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const max = 5;
  const arr = (subscribeRateLimit.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  subscribeRateLimit.set(ip, arr);
  return true;
}

export async function sendTemplatedEmail(
  to: string | string[],
  templateKey: string,
  variables: Record<string, string>,
  recipientName?: string,
  rawHtmlKeys?: Set<string>,
): Promise<void> {
  const rendered = await renderTemplate(templateKey, variables, rawHtmlKeys);
  if (rendered && !rendered.enabled) return;
  const fallback = !rendered ? getDefaultTemplate(templateKey) : null;
  const tpl = rendered || fallback;
  if (!tpl) return;
  const subject = rendered ? tpl.subject : replaceVarsPlain(tpl.subject, variables);
  const body = rendered ? tpl.body : replaceVarsSimple(tpl.body, variables, rawHtmlKeys);
  const sensitiveTemplates = ["password_reset"];
  const isSensitive = sensitiveTemplates.includes(templateKey);
  if (Array.isArray(to)) {
    sendEmailToMultiple(to, subject, body).catch(() => {});
    for (const addr of to) {
      logActivity("email", "email_sent", { summary: recipientName ? `Email to ${recipientName} (${addr}): ${subject}` : `Email to ${addr}: ${subject}`, details: JSON.stringify(isSensitive ? { to: addr, recipientName: recipientName || null, templateKey, subject } : { to: addr, recipientName: recipientName || null, templateKey, subject, body }) });
    }
  } else {
    sendEmail(to, subject, body).catch(() => {});
    logActivity("email", "email_sent", { summary: recipientName ? `Email to ${recipientName} (${to}): ${subject}` : `Email to ${to}: ${subject}`, details: JSON.stringify(isSensitive ? { to, recipientName: recipientName || null, templateKey, subject } : { to, recipientName: recipientName || null, templateKey, subject, body }) });
  }
}

function replaceVarsSimple(template: string, variables: Record<string, string>, rawHtmlKeys?: Set<string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    if (variables[key] === undefined) return match;
    if (rawHtmlKeys && rawHtmlKeys.has(key)) return variables[key];
    return escapeHtml(variables[key]).replace(/\n/g, "<br/>");
  });
}

function replaceVarsPlain(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => variables[key] !== undefined ? variables[key].replace(/\n/g, " ") : match);
}

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

// Max size for a single uploaded file (kept in sync with the multer limit
// below). Surfaced in the friendly rejection message so the number the user
// sees always matches what the server actually enforces.
const MAX_UPLOAD_FILE_SIZE_MB = 25;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024 },
});

// Map a multer rejection (file too large / too many files) to a clear,
// structured response the frontend can show verbatim. Returns null for any
// non-multer error so it falls through to the generic error handler.
function describeUploadRejection(
  err: unknown,
  maxCount: number,
): { status: number; body: { message: string; code: string } } | null {
  if (!(err instanceof multer.MulterError)) return null;
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        body: {
          message: `That file is too large — each attachment must be ${MAX_UPLOAD_FILE_SIZE_MB}MB or less.`,
          code: "FILE_TOO_LARGE",
        },
      };
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 413,
        body: {
          message: `Too many files — you can attach up to ${maxCount} file${maxCount === 1 ? "" : "s"} per reply.`,
          code: "TOO_MANY_FILES",
        },
      };
    default:
      return {
        status: 400,
        body: {
          message: "That attachment couldn't be uploaded. Please try a different file.",
          code: "UPLOAD_REJECTED",
        },
      };
  }
}

// Generic-over-P wrapper around multer's upload.single so that route-param
// inference (e.g. `:id`) is preserved on the final handler. A middleware typed
// with the concrete Request (ParamsDictionary) otherwise pins req.params values
// to `string | string[]`; keeping the wrapper generic lets TS infer the params
// from the route literal instead.
function withUpload(field: string) {
  const handler = upload.single(field);
  return <P>(req: Request<P>, res: Response, next: NextFunction): void => {
    handler(req as Request, res, next);
  };
}

// Same as withUpload but for multiple files under one field (e.g. WHMCS ticket
// reply attachments). Preserves route-param inference like withUpload does.
function withUploadArray(field: string, maxCount: number) {
  const handler = upload.array(field, maxCount);
  return <P>(req: Request<P>, res: Response, next: NextFunction): void => {
    handler(req as Request, res, (err: unknown) => {
      if (err) {
        const rejection = describeUploadRejection(err, maxCount);
        if (rejection) {
          res.status(rejection.status).json(rejection.body);
          return;
        }
        next(err);
        return;
      }
      next();
    });
  };
}

// Cap files per WHMCS ticket reply (multer also caps each file at 25MB).
const WHMCS_REPLY_MAX_ATTACHMENTS = 5;

// Turn multer's in-memory files into the base64 shape the WHMCS client forwards.
function toWhmcsAttachmentUploads(files: Express.Multer.File[] | undefined): WhmcsTicketAttachmentUpload[] {
  return (files ?? []).map((f) => ({ name: f.originalname, base64: f.buffer.toString("base64") }));
}

// Strip characters that would break a Content-Disposition filename (quotes,
// path separators, CR/LF) so a WHMCS-supplied name can't inject headers.
function safeDownloadFilename(name: string): string {
  return (name || "attachment").replace(/[\r\n"\\/]+/g, "_").trim() || "attachment";
}

// Validate + coerce the (type, relatedid, index) attachment locator from a
// download request's query string. Returns null when anything is malformed.
function parseWhmcsAttachmentLocator(
  query: any,
): { type: WhmcsAttachmentOwnerType; relatedId: number; index: number } | null {
  const type = String(query?.type ?? "");
  if (type !== "reply" && type !== "ticket") return null;
  const relatedId = Number(query?.relatedid);
  const index = Number(query?.index);
  if (!Number.isInteger(relatedId) || relatedId <= 0) return null;
  if (!Number.isInteger(index) || index < 0) return null;
  return { type, relatedId, index };
}

async function saveUploadedFile(file: Express.Multer.File): Promise<string> {
  const ext = path.extname(file.originalname);
  const filename = `${crypto.randomUUID()}${ext}`;
  const base64Data = file.buffer.toString("base64");
  await db.insert(uploadedFiles).values({
    filename,
    mimetype: file.mimetype,
    data: base64Data,
  });
  return `/uploads/${filename}`;
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    userAgent?: string;
    ip?: string;
    createdAt?: string;
    lastSeenAt?: string;
  }
}

function requireAuth<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

async function requireAdmin<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

async function requireMasterAdmin<P>(req: Request<P>, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || user.role !== "master_admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

function requirePermission(viewPerm: string, managePerm?: string) {
  return async <P>(req: Request<P>, res: Response, next: NextFunction) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role === "master_admin") return next();
    const isWrite = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
    const requiredPerm = isWrite && managePerm ? managePerm : viewPerm;
    if (!user.adminRoleId) {
      return res.status(403).json({ message: "No admin role assigned" });
    }
    const role = await storage.getAdminRole(user.adminRoleId);
    if (!role || !role.permissions?.includes(requiredPerm)) {
      return res.status(403).json({ message: "Insufficient permissions" });
    }
    next();
  };
}

async function getAdminCategoryAccess(userId: string): Promise<string[]> {
  const user = await storage.getUser(userId);
  if (!user) return [];
  if (user.role === "master_admin") return ["*"];
  if (user.role !== "admin" || !user.adminRoleId) return [];
  const categories = await storage.getAllTicketCategories();
  return categories
    .filter(c => c.assignedRoleIds?.includes(user.adminRoleId!))
    .map(c => c.id);
}

const presenceMap = createPresenceMap();
const wsClients = new Set<WebSocket>();
const ticketViewerCounts = new Map<string, Map<string, { count: number; role: string }>>();
const adminChatViewerCounts = new Map<string, Map<string, number>>();
const threadViewerCounts = new Map<string, Map<string, number>>();
const wsUserMap = new Map<WebSocket, { userId: string; ticketId: string; userRole: string }>();
const wsAdminChatMap = new Map<WebSocket, { userId: string; threadId: string }>();
const wsThreadMap = new Map<WebSocket, { userId: string; threadId: string }>();

function broadcastToThreadViewers(data: any, threadId: string) {
  const message = JSON.stringify(data);
  wsThreadMap.forEach((info, client) => {
    if (info.threadId === threadId && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function addThreadViewer(threadId: string, userId: string): void {
  if (!threadViewerCounts.has(threadId)) threadViewerCounts.set(threadId, new Map());
  const users = threadViewerCounts.get(threadId)!;
  users.set(userId, (users.get(userId) || 0) + 1);
  broadcastToThreadViewers({ type: "thread_presence", threadId, userId, status: "online" }, threadId);
}

function removeThreadViewer(threadId: string, userId: string): void {
  const users = threadViewerCounts.get(threadId);
  if (!users) return;
  const count = (users.get(userId) || 0) - 1;
  if (count <= 0) {
    users.delete(userId);
    broadcastToThreadViewers({ type: "thread_presence", threadId, userId, status: "offline" }, threadId);
  } else {
    users.set(userId, count);
  }
  if (users.size === 0) threadViewerCounts.delete(threadId);
}

function isUserViewingThread(userId: string, threadId: string): boolean {
  const users = threadViewerCounts.get(threadId);
  if (!users) return false;
  return (users.get(userId) || 0) > 0;
}

function broadcastToThreadParticipants(data: any, participantUserIds: string[]) {
  const message = JSON.stringify(data);
  const participantSet = new Set(participantUserIds);
  wsClients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const sessionUid = wsSessionUserMap?.get(client);
    if (sessionUid && participantSet.has(sessionUid)) {
      client.send(message);
    }
  });
}

let wsSessionUserMap: Map<WebSocket, string>;
let wssRef: WebSocketServer | null = null;
export function getWebSocketServer(): WebSocketServer | null {
  return wssRef;
}

function broadcast(data: any) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastExcept(data: any, excludeWs: WebSocket) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

const wsSessionRoleMap = new Map<WebSocket, string>();

function broadcastToAdmins(data: any) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState !== WebSocket.OPEN) return;
    const role = wsSessionRoleMap.get(client);
    if (role === "admin" || role === "master_admin") {
      client.send(message);
    }
  });
}

function addTicketViewer(ticketId: string, userId: string, userRole: string): void {
  if (!ticketViewerCounts.has(ticketId)) ticketViewerCounts.set(ticketId, new Map());
  const users = ticketViewerCounts.get(ticketId)!;
  const existing = users.get(userId);
  const wasThere = existing && existing.count > 0;
  users.set(userId, { count: (existing?.count || 0) + 1, role: userRole });
  if (!wasThere) {
    broadcast({ type: "ticket_presence", ticketId, userId, userRole, status: "online" });
  }
}

function removeTicketViewer(ticketId: string, userId: string): void {
  const users = ticketViewerCounts.get(ticketId);
  if (!users) return;
  const existing = users.get(userId);
  if (!existing) return;
  const newCount = existing.count - 1;
  if (newCount <= 0) {
    const role = existing.role;
    users.delete(userId);
    broadcast({ type: "ticket_presence", ticketId, userId, userRole: role, status: "offline" });
  } else {
    users.set(userId, { ...existing, count: newCount });
  }
  if (users.size === 0) ticketViewerCounts.delete(ticketId);
}

function getTicketViewers(ticketId: string): { userId: string; userRole: string }[] {
  const users = ticketViewerCounts.get(ticketId);
  if (!users) return [];
  return Array.from(users.entries()).map(([userId, info]) => ({ userId, userRole: info.role }));
}

function isUserViewingTicket(userId: string, ticketId: string): boolean {
  const users = ticketViewerCounts.get(ticketId);
  if (!users) return false;
  const existing = users.get(userId);
  return existing ? existing.count > 0 : false;
}

const TICKET_EMAIL_COOLDOWN_MS = 5 * 60 * 1000;
const ticketEmailCooldowns = new Map<string, number>();

function shouldSendTicketEmail(userId: string, ticketId: string): boolean {
  const key = `${userId}:${ticketId}`;
  const lastSent = ticketEmailCooldowns.get(key);
  if (!lastSent) return true;
  return Date.now() - lastSent >= TICKET_EMAIL_COOLDOWN_MS;
}

function recordTicketEmailSent(userId: string, ticketId: string): void {
  ticketEmailCooldowns.set(`${userId}:${ticketId}`, Date.now());
}

setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [key, ts] of ticketEmailCooldowns) {
    if (ts < cutoff) ticketEmailCooldowns.delete(key);
  }
}, 5 * 60 * 1000);

function addAdminChatViewer(threadId: string, userId: string): void {
  if (!adminChatViewerCounts.has(threadId)) adminChatViewerCounts.set(threadId, new Map());
  const users = adminChatViewerCounts.get(threadId)!;
  users.set(userId, (users.get(userId) || 0) + 1);
}

function removeAdminChatViewer(threadId: string, userId: string): void {
  const users = adminChatViewerCounts.get(threadId);
  if (!users) return;
  const count = (users.get(userId) || 0) - 1;
  if (count <= 0) { users.delete(userId); } else { users.set(userId, count); }
  if (users.size === 0) adminChatViewerCounts.delete(threadId);
}

function isUserViewingAdminChat(userId: string, threadId: string): boolean {
  const users = adminChatViewerCounts.get(threadId);
  return users ? (users.get(userId) || 0) > 0 : false;
}

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  const vapidContact = process.env.VAPID_CONTACT_EMAIL || "admin@servicehub.app";
  const vapidSubject = vapidContact.startsWith("mailto:") || vapidContact.startsWith("https:")
    ? vapidContact
    : `mailto:${vapidContact}`;
  webpush.setVapidDetails(
    vapidSubject,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface NotifMeta {
  type: string;
  referenceType?: string;
  referenceId?: string;
}

// ───────────────────────────────────────────────────────────────────────
// Push notification `tag` scheme — keep these resource-level (not
// per-message) so the OS/SW can collapse N back-to-back pushes about
// the same resource into a single rolled-up toast in the tray instead
// of stacking one row per message. The service worker (client/public/
// sw.js) reads `tag` plus the optional `resourceLabel` / `rollupNoun`
// fields on the push payload to craft a "N new <noun> on <label>" body
// when there is already an unread toast for the same tag.
//
// Stable resource-level tags currently in use:
//   ticket-<id>                 — every push tied to one support ticket
//   ticket-transfer-<id>        — admin transfer notice (separate tray row)
//   thread-<id>                 — admin↔customer message thread
//   alert-<id>                  — service alert + alert updates + resolve
//   service-<id>                — service status flips
//   service-update-<serviceId>  — admin-authored service updates per service
//                                 (persisted as referenceType=service_update_group, referenceId=serviceId)
//   news-<authorId>             — news stories grouped by author
//                                 (persisted as referenceType=news_author, referenceId=authorId)
//   admin-chat-<threadId>       — admin chat thread
//   pm-<id>                     — direct private message (per-message OK)
//   report-request-<id>         — report-request notifications
//   report-<id>                 — report status updates
//   monitor-<id>-down/-up       — uptime monitor flips (already coarse)
//   community-warn-<userId>     — community moderation warn
//   community-ban-<userId>      — community moderation ban
//   community-chat              — community chat (single global tag)
//   signup-<userId>             — admin "new signup" toast
// ───────────────────────────────────────────────────────────────────────

// Create the in-app (bell) `user_notifications` row and return its id (or null
// on failure). Decoupled from push so a customer who wants email (or in-app)
// but not push still gets a bell entry — the caller then reuses the returned id
// when firing push via `{ notificationId }` so push users still get exactly one
// row (Task #350/#352). Never throws.
export async function createBellNotification(
  userId: string,
  notif: NotifMeta,
  payload: { title: string; body: string; url?: string },
): Promise<string | null> {
  try {
    const row = await storage.createUserNotification({
      userId,
      type: notif.type,
      title: payload.title,
      body: payload.body,
      referenceType: notif.referenceType || null,
      referenceId: notif.referenceId || null,
      url: payload.url || null,
    });
    return row.id;
  } catch (e) {
    console.error("[UserNotif] Failed to create:", getErrorMessage(e));
    logError("push", e, { severity: "warn", userId, summary: "Failed to create user_notification row" });
    return null;
  }
}

export async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string; resourceLabel?: string; rollupNoun?: string }, notif?: NotifMeta | { notificationId: string }) {
  let notificationId: string | null = null;
  if (notif && "notificationId" in notif) {
    // Caller already created the user_notifications row and is just
    // wiring the existing row's id into the push so the OS toast can
    // use the "Mark as read" action.
    notificationId = notif.notificationId;
  } else if (notif) {
    notificationId = await createBellNotification(userId, notif, payload);
  }
  const richPayload = buildPushPayload(
    {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      tag: payload.tag,
      resourceLabel: payload.resourceLabel,
      rollupNoun: payload.rollupNoun,
    },
    { notificationId },
  );
  try {
    const subs = await storage.getPushSubscriptionsByUser(userId);
    if (subs.length === 0) {
      console.log(`[Push] User ${userId} — no push subscriptions registered`);
      return;
    }
    let sent = 0, failed = 0;
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(richPayload)
        );
        sent++;
      } catch (err) {
        if (getErrorStatusCode(err) === 404 || getErrorStatusCode(err) === 410) {
          await storage.deletePushSubscription(sub.endpoint);
          console.log(`[Push] User ${userId} — removed stale subscription (${getErrorStatusCode(err)})`);
        } else {
          console.error(`[Push] User ${userId} — push failed (${getErrorStatusCode(err)}):`, getErrorMessage(err));
          logError("push", err, {
            severity: "warn",
            userId,
            summary: `Push failed (${getErrorStatusCode(err)}): ${payload.title}`.slice(0, 500),
            extra: { statusCode: getErrorStatusCode(err), endpoint: sub.endpoint, title: payload.title },
          });
        }
        failed++;
      }
    }
    console.log(`[Push] User ${userId} — ${sent} sent, ${failed} failed out of ${subs.length} subscription(s)`);
    if (sent > 0) {
      const pushRecipient = await storage.getUser(userId);
      logActivity("push", "push_sent", { recipientId: userId, summary: `Push to ${pushRecipient?.fullName || "user"}: ${payload.title} — ${payload.body}`, details: JSON.stringify({ recipientName: pushRecipient?.fullName || null, ...payload }) });
    }
    if (failed > 0) {
      logActivity("push", "push_failed", { recipientId: userId, summary: `Push failed to user: ${payload.title}`, details: JSON.stringify({ failed, sent, ...payload }) });
    }
  } catch (e) {
    console.error(`[Push] User ${userId} — error:`, e);
    logError("push", e, { severity: "error", userId, summary: `Push pipeline error: ${payload.title}`.slice(0, 500) });
  }
}

function logActivity(category: string, action: string, opts: { actorId?: string; targetId?: string; targetType?: string; recipientId?: string; summary: string; details?: string }) {
  storage.createActivityLog({ category, action, ...opts }).catch(e => console.error("[ActivityLog] Failed to write:", getErrorMessage(e)));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const PgStore = ConnectPgSimple(session);

  pool.query("UPDATE users SET username = TRIM(username) WHERE username != TRIM(username)")
    .then((r) => { if (r.rowCount && r.rowCount > 0) console.log(`[Migration] Trimmed whitespace from ${r.rowCount} username(s)`); })
    .catch((e) => console.error("[Migration] Failed to trim usernames:", getErrorMessage(e)));
  pool.query("UPDATE users SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name)")
    .then((r) => { if (r.rowCount && r.rowCount > 0) console.log(`[Migration] Trimmed whitespace from ${r.rowCount} full_name(s)`); })
    .catch((e) => console.error("[Migration] Failed to trim full_names:", getErrorMessage(e)));
  pool.query(`UPDATE admin_roles SET permissions = array_append(permissions, 'dashboard.view') WHERE NOT ('dashboard.view' = ANY(permissions))`)
    .then((r) => { if (r.rowCount && r.rowCount > 0) console.log(`[Migration] Added dashboard.view permission to ${r.rowCount} admin role(s)`); })
    .catch((e) => console.error("[Migration] Failed to seed dashboard.view:", getErrorMessage(e)));

  app.set("trust proxy", 1);

  const sessionMiddleware = session({
    store: new PgStore({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "servicehub-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    },
  });

  app.use(sessionMiddleware);

  const SESSION_ENRICH_THROTTLE_MS = 60 * 1000;
  app.use((req, _res, next) => {
    if (req.session && req.session.userId) {
      const nowIso = new Date().toISOString();
      if (!req.session.createdAt) req.session.createdAt = nowIso;
      const ua = req.get("user-agent");
      if (ua && req.session.userAgent !== ua) req.session.userAgent = ua;
      const ip = (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
      if (ip && req.session.ip !== ip) req.session.ip = ip;
      const last = req.session.lastSeenAt ? Date.parse(req.session.lastSeenAt) : 0;
      if (!last || Date.now() - last > SESSION_ENRICH_THROTTLE_MS) {
        req.session.lastSeenAt = nowIso;
      }
    }
    next();
  });

  app.get("/uploads/:filename", async (req, res) => {
    try {
      const filename = req.params.filename;
      const [file] = await db.select().from(uploadedFiles).where(eq(uploadedFiles.filename, filename)).limit(1);
      if (!file) {
        return res.status(404).json({ message: "File not found" });
      }
      const buffer = Buffer.from(file.data, "base64");
      res.set("Content-Type", file.mimetype);
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.send(buffer);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Auth routes
  // Single shared password-reset limiter so forgot + reset share one
  // 3/hour/IP budget instead of getting two separate buckets.
  const passwordResetLimiter = createPasswordResetLimiter();

  app.post("/api/auth/register", createRegisterLimiter(), async (req, res) => {
    try {
      const username = req.body.username?.trim();
      const fullName = req.body.fullName?.trim();
      const { password, email } = req.body;
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already taken" });
      }
      const hashed = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashed, email, fullName, role: "customer", theme: "light" });
      req.session.userId = user.id;
      res.json(sanitizeUser(user));
      logActivity("user", "user_registered", { targetId: user.id, targetType: "user", summary: `New user registered: ${fullName} (${username})`, details: JSON.stringify({ username, email, fullName }) });

      const allUsers = await storage.getAllUsers();
      const admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
      for (const admin of admins) {
        if (shouldSuppressNotification({ user: admin, categoryKey: "admin_new_signup" })) continue;
        void sendPushToUser(admin.id, {
          title: "New Customer Signup",
          body: `${fullName} (${username}) just created an account`,
          url: "/admin",
          tag: `signup-${user.id}`,
        }, { type: "new_signup", referenceType: "user", referenceId: user.id });
      }
      const adminEmails = admins
        .filter(a => !shouldSuppressNotification({ user: a, categoryKey: "admin_new_signup" }))
        .map(a => a.email)
        .filter(Boolean);
      if (adminEmails.length > 0) {
        void sendTemplatedEmail(adminEmails, "admin_new_signup", {
          customer_name: fullName,
          customer_username: username,
          customer_email: email,
        }, "Admins");
      }
      const adminIds = admins.map(a => a.id);
      storage.createContentNotificationBulk(adminIds, "admin-users", `New signup: ${fullName} (${username})`, user.id).catch(() => {});
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  registerAuth2FARoutes(app, {
    storage,
    challenges: totpChallenges,
    verifyPassword,
    isAdminRole,
    sanitizeUser,
    logActivity,
    requireAuth,
    requireMasterAdmin,
    loginMiddleware: [createLoginLimiter()],
  });


  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  // ---------- Active sessions (any signed-in user) ----------
  app.get("/api/me/sessions", requireAuth, async (req, res) => {
    try {
      const rows = await getSessionsForUser(pool, req.session.userId!);
      const currentSid = req.sessionID;
      res.json(rows.map((s) => {
        const ua = parseUserAgent(s.userAgent);
        return {
          sid: s.sid,
          deviceLabel: deviceLabel(s.userAgent),
          device: ua.device,
          browser: ua.browser,
          userAgent: s.userAgent,
          ip: s.ip,
          createdAt: s.createdAt,
          lastSeenAt: s.lastSeenAt,
          expire: s.expire,
          current: s.sid === currentSid,
        };
      }));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/me/sessions/:sid", requireAuth, async (req, res) => {
    try {
      const targetSid = getParam(req, "sid");
      const rows = await getSessionsForUser(pool, req.session.userId!);
      const owned = rows.find(r => r.sid === targetSid);
      if (!owned) return res.status(404).json({ message: "Session not found" });
      await deleteSessionRow(pool, targetSid);
      const isSelf = targetSid === req.sessionID;
      res.json({ ok: true, self: isSelf });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/me/sessions", requireAuth, async (req, res) => {
    try {
      const removed = await deleteSessionsForUser(pool, req.session.userId!, req.sessionID);
      res.json({ ok: true, removed });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  function getBaseUrl(req: Request): string {
    const appBaseUrl = process.env.APP_BASE_URL;
    if (appBaseUrl) return appBaseUrl.replace(/\/+$/, "");
    const hostHeader = req.get("host");
    if (hostHeader) {
      const proto = (req.get("x-forwarded-proto") || (process.env.NODE_ENV === "production" ? "https" : "http")).split(",")[0].trim();
      return `${proto}://${hostHeader}`;
    }
    return "http://localhost:5000";
  }

  app.get("/api/public/status", async (_req, res) => {
    try {
      const cachedPayload = getCachedPublicStatus();
      if (cachedPayload !== null) {
        return res.json(cachedPayload);
      }
      const { computeUptime } = await import("./uptime");
      const [services, alerts, monitors, allUpdates] = await Promise.all([
        storage.getAllServices(),
        storage.getAllAlerts(),
        storage.getAllUrlMonitors(),
        storage.getAllServiceUpdates(),
      ]);
      const monitorsByService = new Map<string, typeof monitors>();
      const monitorToService = new Map<string, string>();
      for (const m of monitors) {
        if (!m.serviceId) continue;
        const arr = monitorsByService.get(m.serviceId) || [];
        arr.push(m);
        monitorsByService.set(m.serviceId, arr);
        monitorToService.set(m.id, m.serviceId);
      }
      const incidentsByService = new Map<string, MonitorIncident[]>();
      const allMonitorIds = Array.from(monitorToService.keys());
      if (allMonitorIds.length > 0) {
        const allIncidents = await storage.getMonitorIncidentsForMonitorIds(allMonitorIds);
        for (const inc of allIncidents) {
          const sid = monitorToService.get(inc.monitorId);
          if (!sid) continue;
          const arr = incidentsByService.get(sid) || [];
          arr.push(inc);
          incidentsByService.set(sid, arr);
        }
      }
      // Include ALL unresolved alerts plus any alerts touched in the last 14 days,
      // so the public page never hides an active incident behind a wall of recently
      // resolved ones.
      const FOURTEEN_DAYS = 14 * 86400000;
      const cutoff = Date.now() - FOURTEEN_DAYS;
      const sortedAlerts = [...alerts]
        .filter((a) => {
          if (a.status !== "resolved") return true;
          const t = a.resolvedAt?.getTime?.() || a.createdAt?.getTime?.() || 0;
          return t >= cutoff;
        })
        .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0));
      const serviceMap = new Map(services.map(s => [s.id, s.name]));
      const updatesByAlert = new Map<string, Date>();
      const alertIds = sortedAlerts.map((a) => a.id);
      if (alertIds.length > 0) {
        const ups = await storage.getAlertUpdatesForAlertIds(alertIds);
        // ups is ordered by createdAt desc — first seen per alertId is newest.
        for (const u of ups) {
          if (!updatesByAlert.has(u.alertId)) updatesByAlert.set(u.alertId, u.createdAt);
        }
      }
      const payload = {
        services: services.map(s => {
          const hasMonitor = (monitorsByService.get(s.id) || []).length > 0;
          const uptime = computeUptime(incidentsByService.get(s.id) || [], hasMonitor);
          return {
            id: s.id,
            name: s.name,
            status: s.status,
            category: s.category || "Other",
            hasMonitor,
            uptime30d: uptime.uptime30d,
            dailyBuckets: uptime.dailyBuckets,
          };
        }),
        alerts: sortedAlerts.map(a => {
          const serviceNames = a.serviceIds.map(id => serviceMap.get(id)).filter((n): n is string => !!n);
          return {
            id: a.id,
            title: a.title,
            status: a.status,
            severity: a.severity,
            serviceNames: serviceNames.length > 0 ? serviceNames : ["Service"],
            serviceName: serviceNames.length > 0 ? serviceNames.join(", ") : "Service",
            createdAt: a.createdAt,
            resolvedAt: a.resolvedAt,
            lastUpdateAt: updatesByAlert.get(a.id) || a.resolvedAt || a.createdAt,
          };
        }),
        updates: (() => {
          const THIRTY_DAYS = 30 * 86400000;
          const updateCutoff = Date.now() - THIRTY_DAYS;
          return allUpdates
            .filter((u) => !u.matureContent && (u.createdAt?.getTime?.() || 0) >= updateCutoff)
            .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
            .slice(0, 10)
            .map((u) => ({
              id: u.id,
              title: u.title,
              description: u.description,
              serviceName: serviceMap.get(u.serviceId) || "Service",
              createdAt: u.createdAt,
            }));
        })(),
      };
      setCachedPublicStatus(payload);
      res.json(payload);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Per-IP rate limiter for public incident detail (60 / minute).
  const incidentRateLimit = new Map<string, number[]>();
  function checkIncidentRateLimit(ip: string): boolean {
    const now = Date.now();
    const windowMs = 60 * 1000;
    const max = 60;
    const arr = (incidentRateLimit.get(ip) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return false;
    arr.push(now);
    incidentRateLimit.set(ip, arr);
    return true;
  }

  app.get("/api/public/incidents/:id", async (req, res) => {
    try {
      const ip = req.ip || "unknown";
      if (!checkIncidentRateLimit(ip)) {
        const retryAfterSeconds = 60;
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({ message: "Too many requests. Please try again in a minute.", retryAfterSeconds });
      }
      const alert = await storage.getAlert(req.params.id);
      if (!alert) return res.status(404).json({ message: "Incident not found" });
      const [coveredServicesRaw, updates] = await Promise.all([
        Promise.all(alert.serviceIds.map(sid => storage.getService(sid))),
        storage.getAlertUpdates(alert.id),
      ]);
      const coveredServices = coveredServicesRaw.filter((s): s is Service => !!s);
      const service = coveredServices[0];
      const serviceNames = coveredServices.map(s => s.name);
      const createdAtMs = alert.createdAt?.getTime?.() || 0;
      const resolvedAtMs = alert.resolvedAt?.getTime?.() || 0;
      const durationSeconds = createdAtMs
        ? Math.max(0, Math.floor(((resolvedAtMs || Date.now()) - createdAtMs) / 1000))
        : 0;
      const isResolved = alert.status === "resolved";
      res.set("Cache-Control", isResolved ? "public, max-age=300" : "public, max-age=30");
      res.json({
        id: alert.id,
        title: alert.title,
        description: alert.description,
        status: alert.status,
        severity: alert.severity,
        serviceName: serviceNames.length > 0 ? serviceNames.join(", ") : "Service",
        serviceNames: serviceNames.length > 0 ? serviceNames : ["Service"],
        serviceCategory: service?.category || null,
        createdAt: alert.createdAt,
        resolvedAt: alert.resolvedAt,
        durationSeconds,
        updates: updates.map((u) => ({
          id: u.id,
          message: u.message,
          status: u.status,
          imageUrl: u.imageUrl,
          createdAt: u.createdAt,
        })),
      });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/public/subscribe", async (req, res) => {
    try {
      const ip = req.ip || "unknown";
      if (!checkSubscribeRateLimit(ip)) {
        return res.status(429).json({ message: "Too many subscription attempts. Please try again in a minute." });
      }
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: "A valid email is required" });
      }
      const baseUrl = getBaseUrl(req);

      // Per-service follow if serviceId provided
      if (typeof req.body?.serviceId === "string" && req.body.serviceId) {
        const eventsParse = z.array(z.enum(["status", "incident", "resolved"])).min(1).safeParse(req.body.events);
        if (!eventsParse.success) return res.status(400).json({ message: "events must include at least one of status/incident/resolved" });
        const events = eventsParse.data;
        const service = await storage.getService(req.body.serviceId);
        if (!service) return res.status(404).json({ message: "Service not found" });
        const existing = await storage.findServiceSubscriber(email, service.id);
        let subscriber;
        if (existing) {
          if (existing.confirmedAt) {
            return res.json({ message: "Already subscribed", confirmed: true });
          }
          await storage.updateServiceSubscriberEvents(existing.id, events);
          subscriber = { ...existing, events };
        } else {
          const token = crypto.randomBytes(24).toString("hex");
          subscriber = await storage.createServiceSubscriber({
            email,
            serviceId: service.id,
            events,
            unsubscribeToken: token,
          });
        }
        const eventLabels: Record<string, string> = {
          status: "service status changes",
          incident: "new incidents",
          resolved: "incident resolutions",
        };
        sendTemplatedEmail(email, "subscribe_confirm", {
          service_name: service.name,
          events_summary: events.map((e) => eventLabels[e]).join(", "),
          confirm_link: `${baseUrl}/api/public/subscribe/confirm?token=${encodeURIComponent(subscriber.unsubscribeToken)}`,
          unsubscribe_link: `${baseUrl}/api/public/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribeToken)}`,
        }).catch(() => {});
        return res.json({ message: "Confirmation email sent. Please check your inbox to complete the subscription." });
      }

      return res.status(400).json({ message: "serviceId is required" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const subscribeHtmlPage = (title: string, message: string, ok: boolean) => `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b1220;color:#e5e7eb;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}.card{max-width:480px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:12px;padding:32px;text-align:center}.icon{font-size:48px;margin-bottom:16px}h1{margin:0 0 12px;font-size:22px}p{margin:0 0 24px;color:#9ca3af;line-height:1.5}a{display:inline-block;padding:10px 20px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600}</style>
</head><body><div class="card"><div class="icon">${ok ? "✓" : "ⓘ"}</div><h1>${title}</h1><p>${message}</p><a href="/status">Back to status page</a></div></body></html>`;

  app.get("/api/public/subscribe/confirm", async (req, res) => {
    const token = queryString(req.query.token) || "";
    if (!token) return res.status(400).type("html").send(subscribeHtmlPage("Invalid link", "Missing confirmation token.", false));
    const sub = await storage.getServiceSubscriberByToken(token);
    if (!sub) return res.status(404).type("html").send(subscribeHtmlPage("Link not found", "This confirmation link is no longer valid.", false));
    if (!sub.confirmedAt) {
      await storage.confirmServiceSubscriber(sub.id);
    }
    const service = await storage.getService(sub.serviceId);
    res.type("html").send(subscribeHtmlPage("Subscription confirmed", `You're now following <strong>${escapeHtml(service?.name || "this service")}</strong>. We'll email you when something changes.`, true));
  });

  app.get("/api/public/unsubscribe", async (req, res) => {
    try {
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!token) return res.status(400).send("Missing token");

      // Per-service follow token first
      const serviceSub = await storage.getServiceSubscriberByToken(token);
      if (serviceSub) {
        const service = await storage.getService(serviceSub.serviceId);
        await storage.deleteServiceSubscriber(serviceSub.id);
        return res.type("html").send(subscribeHtmlPage("Unsubscribed", `You won't receive any more updates for <strong>${escapeHtml(service?.name || "this service")}</strong>.`, true));
      }

      // Fall back to legacy global subscriber so existing email links still work
      const removed = await storage.deletePublicStatusSubscriberByToken(token);
      res.set("Content-Type", "text/html");
      res.send(`<!doctype html><html><body style="font-family:system-ui;padding:40px;max-width:600px;margin:0 auto;"><h2>${removed ? "Unsubscribed" : "Not found"}</h2><p>${removed ? "You've been unsubscribed from CowboyMedia status updates." : "That unsubscribe link is no longer valid."}</p></body></html>`);
    } catch {
      res.status(500).send("Error");
    }
  });

  app.post("/api/auth/forgot-password", passwordResetLimiter, async (req, res) => {
    try {
      const { usernameOrEmail } = req.body;
      if (!usernameOrEmail || typeof usernameOrEmail !== "string") {
        return res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
      }
      const input = usernameOrEmail.trim();
      let user = await storage.getUserByUsername(input);
      if (!user) {
        user = await storage.getUserByEmail(input);
      }
      if (!user) {
        return res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
      }
      const rawToken = crypto.randomBytes(32).toString("hex");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await storage.createPasswordResetToken({ userId: user.id, tokenHash, expiresAt });
      const appBaseUrl = process.env.APP_BASE_URL;
      let baseUrl: string;
      if (appBaseUrl) {
        baseUrl = appBaseUrl.replace(/\/+$/, "");
      } else if (process.env.NODE_ENV === "production") {
        // Final fallback in production: request Host header. Documented in
        // RUNBOOK + .env.template that operators SHOULD set APP_BASE_URL on
        // the VPS so this branch never runs (Host is attacker-controllable
        // and using it for outbound email links is a phishing surface).
        // Trust proxy is enabled, so x-forwarded-host/proto are honoured.
        const hostHeader = req.get("host");
        if (hostHeader) {
          const proto = (req.get("x-forwarded-proto") || "https").split(",")[0].trim();
          baseUrl = `${proto}://${hostHeader}`;
          console.warn(
            "Password reset: APP_BASE_URL not set; falling back to request Host. " +
            "Set APP_BASE_URL in production to remove this Host-header dependency."
          );
        } else {
          console.error("Password reset: no APP_BASE_URL or Host header available");
          return res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
        }
      } else {
        baseUrl = `http://localhost:5000`;
      }
      const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;
      void sendTemplatedEmail(user.email, "password_reset", {
        fullName: user.fullName,
        resetLink,
        expiryMinutes: "60",
      }, user.fullName);
      logActivity("user", "password_reset_requested", { targetId: user.id, targetType: "user", summary: `Password reset requested for ${user.fullName} (${user.username})` });
      res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
    } catch {
      res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
    }
  });

  app.post("/api/auth/reset-password", passwordResetLimiter, async (req, res) => {
    try {
      const { token, password } = req.body;
      if (!token || !password) {
        return res.status(400).json({ message: "Token and password are required" });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
      const resetToken = await storage.getPasswordResetTokenByHash(tokenHash);
      if (!resetToken) {
        return res.status(400).json({ message: "Invalid or expired reset link. Please request a new one." });
      }
      if (resetToken.usedAt) {
        return res.status(400).json({ message: "This reset link has already been used. Please request a new one." });
      }
      if (new Date() > resetToken.expiresAt) {
        return res.status(400).json({ message: "This reset link has expired. Please request a new one." });
      }
      const hashed = await hashPassword(password);
      await storage.updateUser(resetToken.userId, { password: hashed });
      await storage.markPasswordResetTokenUsed(resetToken.id);
      const user = await storage.getUser(resetToken.userId);
      logActivity("user", "password_reset_completed", { targetId: resetToken.userId, targetType: "user", summary: `Password reset completed for ${user?.fullName || "unknown"} (${user?.username || "unknown"})` });
      res.json({ message: "Password has been reset successfully. You can now sign in with your new password." });
    } catch {
      res.status(500).json({ message: "An error occurred. Please try again." });
    }
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    res.json(sanitizeUser(user));
  });

  app.patch("/api/auth/settings", requireAuth, async (req, res) => {
    try {
      const { subscribedServices, fullName, setupReminderDismissed, servicesPickerDismissed } = req.body;
      const updateData: any = {};
      if (subscribedServices !== undefined) updateData.subscribedServices = subscribedServices;
      if (fullName !== undefined) updateData.fullName = fullName?.trim();
      if (setupReminderDismissed !== undefined) updateData.setupReminderDismissed = setupReminderDismissed;
      if (servicesPickerDismissed !== undefined) updateData.servicesPickerDismissed = !!servicesPickerDismissed;
      const updated = await storage.updateUser(req.session.userId!, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/users/me/version-welcome-seen", requireAuth, async (req, res) => {
    try {
      const { version } = req.body || {};
      if (typeof version !== "string" || !version.trim()) {
        return res.status(400).json({ message: "version required" });
      }
      const updated = await storage.updateUser(req.session.userId!, { lastVersionWelcomeSeen: version.trim() });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Latest published changelog entry the current user hasn't dismissed yet.
  // Returns null when there's nothing to show (no published entries, or the
  // newest one matches users.lastVersionWelcomeSeen). The admin-write side
  // (publish flag) is the gate — bumping APP_VERSION alone never fires the
  // popup; only Publish does.
  app.get("/api/version-welcome", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });
      const latest = await storage.getLatestPublishedChangelogEntry();
      const selected = selectVersionWelcome(
        latest ? { version: latest.version, title: latest.title } : null,
        user.lastVersionWelcomeSeen,
      );
      res.json(selected);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Customer-facing What's New page data — published entries only, newest
  // first. Each row's bodyHtml was sanitized on write; we trust it on read.
  app.get("/api/changelog", requireAuth, async (_req, res) => {
    try {
      const rows = await storage.getPublishedChangelogEntries();
      // Defense-in-depth: sanitize on read too, in case a row was inserted by
      // a path that bypassed the write-side sanitizer (legacy seed, manual
      // SQL, future migration).
      res.json(rows.map(r => ({
        version: r.version,
        title: r.title,
        bodyHtml: sanitizeNewsContent(r.bodyHtml),
        publishedAt: r.publishedAt,
      })));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ---- Admin: changelog CRUD (master_admin only) ----
  app.get("/api/admin/changelog", requireMasterAdmin, async (_req, res) => {
    try {
      // Defeat both the PWA service-worker API cache and any intermediate
      // HTTP cache so out-of-band appends (e.g. agent calls to /append) are
      // never masked by a stale copy.
      res.set("Cache-Control", "no-store");
      res.json(await storage.getAllChangelogEntries());
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  });

  app.post("/api/admin/changelog", requireMasterAdmin, async (req, res) => {
    try {
      const parsed = insertChangelogEntrySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ message: "Invalid body", errors: parsed.error.flatten() });
      const data = parsed.data;
      // Force-create as draft regardless of incoming status — publish has its own endpoint.
      const existing = await storage.getChangelogEntry(data.version);
      if (existing) return res.status(409).json({ message: `Entry for version ${data.version} already exists` });
      const created = await storage.createChangelogEntry({
        version: data.version,
        title: data.title ?? "",
        bodyHtml: sanitizeNewsContent(data.bodyHtml ?? ""),
        status: "draft",
        publishedAt: null,
        publishedBy: null,
      });
      res.status(201).json(created);
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  });

  app.patch("/api/admin/changelog/:version", requireMasterAdmin, async (req, res) => {
    try {
      const body = req.body as { title?: unknown; bodyHtml?: unknown };
      const patch: Partial<Pick<InsertChangelogEntry, "title" | "bodyHtml">> = {};
      if (typeof body?.title === "string") patch.title = body.title;
      if (typeof body?.bodyHtml === "string") patch.bodyHtml = sanitizeNewsContent(body.bodyHtml);
      const updated = await storage.updateChangelogEntry(getParam(req, "version"), patch);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  });

  // Agent-friendly bullet appender. The agent (and any other automated
  // caller) sends one bullet at a time scoped to a heading bucket; the
  // server merges it into the existing bodyHtml under the matching <h3>
  // (creating the section if missing), re-sanitizes the result, and saves.
  // Keeps agent edits small, atomic, and safe — and avoids the agent ever
  // round-tripping the entire body, which would risk wiping editorial
  // tweaks the user made between appends.
  // Shared body for both the session-gated admin route and the bearer-gated
  // agent route. Same validation, same merge, same sanitize, same return —
  // the only thing that differs between the two surfaces is auth.
  async function handleChangelogAppend(req: Request, res: Response) {
    try {
      const { heading, bullet } = (req.body || {}) as { heading?: unknown; bullet?: unknown };
      if (!isBulletHeading(heading)) {
        return res.status(400).json({ message: "heading must be one of: New, Improved, Fixed" });
      }
      if (typeof bullet !== "string" || !bullet.trim()) {
        return res.status(400).json({ message: "bullet required" });
      }
      // Enforce the "current version only" invariant on the server too —
      // not just by agent discipline. Prevents accidental writes to an
      // older draft if APP_VERSION has moved on.
      if (req.params.version !== APP_VERSION) {
        return res.status(409).json({
          message: `Can only append to the current APP_VERSION (${APP_VERSION})`,
        });
      }
      const existing = await storage.getChangelogEntry(req.params.version);
      if (!existing) return res.status(404).json({ message: "Not found" });
      if (existing.status !== "draft") {
        return res.status(409).json({ message: "Cannot append to a published entry" });
      }
      const merged = appendBulletToBody(existing.bodyHtml ?? "", heading, bullet);
      const updated = await storage.updateChangelogEntry(req.params.version, {
        bodyHtml: sanitizeNewsContent(merged),
      });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  }

  app.post("/api/admin/changelog/:version/append", requireMasterAdmin, handleChangelogAppend);

  // Bearer-token twin of the route above. Same body, same merge, same
  // response shape — auth is the only difference. Lets the Replit agent
  // (or any other automated caller) POST a bullet straight at production
  // without piggybacking on a master_admin browser session. The token
  // lives in `CHANGELOG_APPEND_TOKEN` on the VPS (mirror in Replit Secrets
  // so the agent's append script can read it). See replit.md.
  app.post(
    "/api/agent/changelog/:version/append",
    requireAgentToken("CHANGELOG_APPEND_TOKEN"),
    handleChangelogAppend,
  );

  app.post("/api/admin/changelog/:version/publish", requireMasterAdmin, async (req, res) => {
    try {
      const updated = await storage.publishChangelogEntry(getParam(req, "version"), req.session.userId!);
      if (!updated) return res.status(404).json({ message: "Not found" });
      res.json(updated);
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  });

  app.delete("/api/admin/changelog/:version", requireMasterAdmin, async (req, res) => {
    try {
      const ok = await storage.deleteChangelogEntry(getParam(req, "version"));
      if (!ok) return res.status(409).json({ message: "Cannot delete: entry not found or already published" });
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ message: getErrorMessage(e) }); }
  });

  app.patch("/api/auth/onboarding-complete", requireAuth, async (req, res) => {
    try {
      const updated = await storage.updateUser(req.session.userId!, { onboardingTourCompletedAt: new Date() });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/auth/notification-prefs", requireAuth, async (req, res) => {
    try {
      const me = await storage.getUser(req.session.userId!);
      if (!me) return res.status(404).json({ message: "User not found" });
      const current: NotificationPrefs = me.notificationPrefs ?? {};
      let next: NotificationPrefs;

      const role = (me.role || "customer") as AppRole;

      if (req.body && typeof req.body === "object" && req.body.prefs && typeof req.body.prefs === "object") {
        const incoming = req.body.prefs as NotificationPrefs;
        // Start from current so prefs for categories not visible to this role are preserved.
        const sanitized: NotificationPrefs = { ...current };
        for (const key of Object.keys(incoming)) {
          if (!NOTIFICATION_CATEGORY_KEYS.includes(key)) continue;
          const entry = incoming[key];
          if (!entry || typeof entry !== "object") continue;
          const cat = NOTIFICATION_CATEGORIES.find((c) => c.key === key);
          if (!cat) continue;
          if (!isCategoryVisibleToRole(cat, role)) continue;
          const cleaned: { push?: boolean; email?: boolean } = {};
          if (typeof entry.push === "boolean" && cat.channels.includes("push")) cleaned.push = entry.push;
          if (typeof entry.email === "boolean" && cat.channels.includes("email")) cleaned.email = entry.email;
          if (Object.keys(cleaned).length > 0) sanitized[key] = cleaned;
          else delete sanitized[key];
        }
        next = sanitized;
      } else {
        const { categoryKey, channel, enabled } = req.body || {};
        if (typeof categoryKey !== "string" || !NOTIFICATION_CATEGORY_KEYS.includes(categoryKey)) {
          return res.status(400).json({ message: "Invalid category" });
        }
        if (channel !== "push" && channel !== "email") {
          return res.status(400).json({ message: "Invalid channel" });
        }
        if (typeof enabled !== "boolean") {
          return res.status(400).json({ message: "Invalid enabled value" });
        }
        const cat = NOTIFICATION_CATEGORIES.find((c) => c.key === categoryKey);
        if (!cat || !cat.channels.includes(channel)) {
          return res.status(400).json({ message: "Channel not supported for this category" });
        }
        if (!isCategoryVisibleToRole(cat, role)) {
          return res.status(403).json({ message: "Category not available for your role" });
        }
        next = { ...current, [categoryKey]: { ...(current[categoryKey] || {}), [channel]: enabled } };
      }

      const updated = await storage.updateUser(req.session.userId!, { notificationPrefs: next });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const parsed = updateProfileSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid profile data" });
      }
      const data: Partial<{ avatarUrl: string | null; bio: string | null }> = {};
      if (parsed.data.avatarUrl !== undefined) data.avatarUrl = parsed.data.avatarUrl ?? null;
      if (parsed.data.bio !== undefined) {
        const trimmed = parsed.data.bio == null ? null : parsed.data.bio.trim();
        data.bio = trimmed && trimmed.length > 0 ? trimmed : null;
      }
      const updated = await storage.updateUser(req.session.userId!, data);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/auth/quiet-hours", requireAuth, async (req, res) => {
    try {
      const parsed = updateQuietHoursSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid quiet hours", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      const updateData: Record<string, any> = {};
      if (data.enabled !== undefined) updateData.quietHoursEnabled = data.enabled;
      if (data.start !== undefined) updateData.quietHoursStart = data.start;
      if (data.end !== undefined) updateData.quietHoursEnd = data.end;
      if (data.timezone !== undefined) {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: data.timezone });
        } catch {
          return res.status(400).json({ message: `Unknown timezone: ${data.timezone}` });
        }
        updateData.quietHoursTimezone = data.timezone;
      }
      if (data.allowCritical !== undefined) updateData.quietHoursAllowCritical = data.allowCritical;
      const updated = await storage.updateUser(req.session.userId!, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/auth/profile/avatar", requireAuth, withUpload("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image provided" });
      if (!req.file.mimetype.startsWith("image/")) {
        return res.status(400).json({ message: "File must be an image" });
      }
      const url = await saveUploadedFile(req.file);
      const updated = await storage.updateUser(req.session.userId!, { avatarUrl: url });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ url, user: sanitizeUser(updated) });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/users/:id/profile", requireAuth, async (req, res) => {
    try {
      const target = await storage.getUser(getParam(req, "id"));
      if (!target) return res.status(404).json({ message: "User not found" });
      const viewer = await storage.getUser(req.session.userId!);
      const viewerIsAdmin = viewer?.role === "admin" || viewer?.role === "master_admin";
      const targetTickets = await storage.getTicketsByCustomer(target.id);
      const stats = {
        ticketCount: targetTickets.length,
        accountAgeDays: computeAccountAgeDays(target.createdAt),
      };
      const badges = computeUserBadges(
        { role: target.role, email: target.email, createdAt: target.createdAt },
        stats,
      );
      const isSelf = viewer?.id === target.id;
      res.json({
        id: target.id,
        fullName: viewerIsAdmin || isSelf ? target.fullName : (target.chatUsername || target.fullName),
        chatUsername: target.chatUsername || null,
        avatarUrl: target.avatarUrl || null,
        bio: target.bio || null,
        memberSince: target.createdAt,
        badges,
        ticketCount: stats.ticketCount,
      });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/users/:id/reset-notification-prefs", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const target = await storage.getUser(getParam(req, "id"));
      if (!target) return res.status(404).json({ message: "User not found" });
      const updated = await storage.updateUser(getParam(req, "id"), { notificationPrefs: {} });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Public API routes
  app.get(
    "/api/search",
    requireAuth,
    createSearchHandler({
      storage,
      getAccessibleTicketCategoryIds: (uid) => getAdminCategoryAccess(uid).then((ids) => (ids.includes("*") ? "*" : ids)),
    }),
  );

  app.get("/api/services", requireAuth, async (req, res) => {
    const result = await storage.getAllServices();
    const user = await storage.getUser(req.session.userId!);
    const isAdmin = user?.role === "admin" || user?.role === "master_admin";
    if (isAdmin) return res.json(result);
    const sanitized = result.map(({ discordWebhookUrl: _omit, ...rest }) => rest);
    res.json(sanitized);
  });

  app.get("/api/alerts", requireAuth, async (_req, res) => {
    const result = await storage.getAllAlerts();
    res.json(result);
  });

  app.get("/api/alerts/:id", requireAuth, async (req, res) => {
    const alert = await storage.getAlert(getParam(req, "id"));
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  });

  app.get("/api/alerts/:id/updates", requireAuth, async (req, res) => {
    const updates = await storage.getAlertUpdates(getParam(req, "id"));
    res.json(updates);
  });

  app.get("/api/news", requireAuth, async (_req, res) => {
    const result = await storage.getAllNews();
    res.json(result);
  });

  app.get("/api/news/:id", requireAuth, async (req, res) => {
    const story = await storage.getNewsStory(getParam(req, "id"));
    if (!story) return res.status(404).json({ message: "Story not found" });
    res.json(story);
  });

  function aggregateNewsReactions(rows: { emoji: string; userId: string }[], userId: string) {
    const map = new Map<string, { emoji: string; count: number; mine: boolean }>();
    for (const r of rows) {
      const g = map.get(r.emoji) ?? { emoji: r.emoji, count: 0, mine: false };
      g.count += 1;
      if (r.userId === userId) g.mine = true;
      map.set(r.emoji, g);
    }
    return Array.from(map.values());
  }

  app.get("/api/news/reactions/all", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const stories = await storage.getAllNews();
      const rows = await storage.getNewsReactions(stories.map(s => s.id));
      const byStory: Record<string, { emoji: string; userId: string }[]> = {};
      for (const r of rows) {
        (byStory[r.storyId] ||= []).push({ emoji: r.emoji, userId: r.userId });
      }
      const result: Record<string, { emoji: string; count: number; mine: boolean }[]> = {};
      for (const id of Object.keys(byStory)) {
        result[id] = aggregateNewsReactions(byStory[id], userId);
      }
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/news/:id/reactions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const rows = await storage.getNewsReactionsForStory(getParam(req, "id"));
      res.json(aggregateNewsReactions(rows, userId));
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/news/:id/reactions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const { emoji } = req.body ?? {};
      if (!emoji || typeof emoji !== "string") {
        return res.status(400).json({ error: "Emoji is required" });
      }
      if (!(NEWS_REACTION_EMOJIS as readonly string[]).includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji" });
      }
      const story = await storage.getNewsStory(getParam(req, "id"));
      if (!story) return res.status(404).json({ error: "Story not found" });
      const result = await storage.toggleNewsReaction(getParam(req, "id"), userId, emoji);
      const rows = await storage.getNewsReactionsForStory(getParam(req, "id"));
      res.json({ ...result, reactions: aggregateNewsReactions(rows, userId) });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  // Tickets
  app.get("/api/tickets", requireAuth, async (req, res) => {
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role === "admin" || user.role === "master_admin") {
      let result = await storage.getAllTickets();
      if (user.role !== "master_admin") {
        const accessibleCategoryIds = await getAdminCategoryAccess(user.id);
        if (!accessibleCategoryIds.includes("*")) {
          result = result.filter(t => !t.categoryId || accessibleCategoryIds.includes(t.categoryId));
        }
        const pendingTransfers = await storage.getPendingTransfersForAdmin(user.id);
        const pendingTransferTicketIds = new Set(pendingTransfers.map(t => t.ticketId));
        result = result.filter(t => !t.claimedBy || t.claimedBy === user.id || pendingTransferTicketIds.has(t.id));
      }
      const claimedIds = Array.from(new Set(result.map(t => t.claimedBy).filter((v): v is string => !!v)));
      const claimedNameById = new Map<string, string>();
      if (claimedIds.length > 0) {
        const admins = await storage.getUsersByIds(claimedIds);
        for (const a of admins) claimedNameById.set(a.id, a.fullName);
      }
      const enriched = result.map((t) => ({
        ...t,
        claimedByName: t.claimedBy ? (claimedNameById.get(t.claimedBy) || "Unknown") : null,
      }));
      res.json(enriched);
    } else {
      const result = await storage.getTicketsByCustomer(user.id);
      res.json(result);
    }
  });

  app.get("/api/tickets/:id", requireAuth, async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin" && user.role !== "master_admin" && ticket.customerId !== user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "admin" && ticket.categoryId) {
        const accessibleCategoryIds = await getAdminCategoryAccess(user.id);
        if (!accessibleCategoryIds.includes("*") && !accessibleCategoryIds.includes(ticket.categoryId)) {
          return res.status(403).json({ message: "No access to this ticket category" });
        }
      }
      if (user.role === "admin" && ticket.claimedBy && ticket.claimedBy !== user.id) {
        const pendingTransfer = await storage.getPendingTransferByTicketId(ticket.id);
        if (!pendingTransfer || pendingTransfer.toAdminId !== user.id) {
          return res.status(403).json({ message: "This ticket is claimed by another admin" });
        }
      }
      let claimedByName: string | null = null;
      if (ticket.claimedBy) {
        const claimedAdmin = await storage.getUser(ticket.claimedBy);
        claimedByName = claimedAdmin?.fullName || "Unknown";
      }
      res.json({ ...ticket, claimedByName });
    } catch (e) {
      if (getErrorCode(e) === "22P02") return res.status(404).json({ message: "Ticket not found" });
      throw e;
    }
  });

  app.post("/api/tickets", requireAuth, bypassRateLimitForAdmins, createTicketLimiter(), withUpload("image"), async (req, res) => {
    try {
      const { subject, description, serviceId, priority, categoryId } = req.body;
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const ticket = await storage.createTicket({
        subject,
        description,
        serviceId: serviceId || null,
        categoryId: categoryId || null,
        priority: priority || "medium",
        customerId: req.session.userId!,
        status: "open",
        imageUrl: imageUrl || null,
      });
      broadcast({ type: "new_ticket", ticket });
      const customer = await storage.getUser(req.session.userId!);
      logActivity("ticket", "ticket_opened", { actorId: req.session.userId!, targetId: ticket.id, targetType: "ticket", summary: `Ticket opened by ${customer?.fullName || "Unknown"}: ${ticket.subject}`, details: JSON.stringify({ customer: customer?.fullName, customerEmail: customer?.email, subject: ticket.subject, description: ticket.description, priority: ticket.priority, serviceId: ticket.serviceId }) });
      const service = ticket.serviceId ? await storage.getService(ticket.serviceId) : null;
      const allUsers = await storage.getAllUsers();
      let admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
      if (ticket.categoryId) {
        const category = await storage.getTicketCategory(ticket.categoryId);
        if (category && category.assignedRoleIds && category.assignedRoleIds.length > 0) {
          admins = admins.filter(a => a.role === "master_admin" || (a.adminRoleId && category.assignedRoleIds!.includes(a.adminRoleId)));
        }
      }
      for (const admin of admins) {
        if (adminWantsPush(admin, "admin_new_ticket")) {
          void sendPushToUser(admin.id, {
            title: "New Support Ticket",
            body: `${customer?.fullName}: ${ticket.subject}`,
            url: `/admin?tab=support-tickets&ticket=${ticket.id}`,
            tag: `ticket-${ticket.id}`,
            resourceLabel: `Ticket: ${ticket.subject}`,
            rollupNoun: "messages",
          }, { type: "new_ticket", referenceType: "ticket", referenceId: ticket.id });
        }
        void storage.createTicketNotification({
          userId: admin.id,
          ticketId: ticket.id,
          type: "new_ticket",
          message: `New ticket from ${customer?.fullName}: ${ticket.subject}`,
        });
        if (admin.email && customer && !shouldSuppressNotification({ user: admin, categoryKey: "admin_new_ticket" })) {
          void sendTemplatedEmail(admin.email, "admin_new_ticket", {
            customer_name: customer.fullName,
            customer_username: customer.username,
            customer_email: customer.email,
            service_name: service?.name || "N/A",
            ticket_subject: ticket.subject,
            ticket_priority: ticket.priority,
            ticket_description: ticket.description,
          }, admin.fullName);
        }
      }

      let autoReplyText = "Thank you for contacting CowboyMedia support through our ServiceHub app. We will review your support ticket and respond as quickly as possible. Thank you!";
      try {
        const awayRow = await storage.getSupportAway();
        const awayStatus = computeSupportAwayStatus(awayRow);
        if (awayStatus.isActive) {
          autoReplyText = awayRow.message;
        }
      } catch {
        // If the away lookup fails, keep the default auto-reply.
      }
      try {
        let supportUser = await storage.getUserByUsername("cowboymedia-support");
        if (!supportUser) {
          supportUser = await storage.createUser({
            username: "cowboymedia-support",
            password: "nologin-system-account",
            email: "noreply@cowboymedia.net",
            fullName: "CowboyMedia Support",
            role: "admin",
            theme: "light",
          });
          console.log("Created cowboymedia-support system user:", supportUser.id);
        }
        const autoMessage = await storage.createTicketMessage({
          ticketId: ticket.id,
          senderId: supportUser.id,
          message: autoReplyText,
          imageUrl: null,
        });
        broadcast({ type: "ticket_message", ticketId: ticket.id, message: autoMessage });

        const receivedWantsPush = customerWantsPush(customer, "ticket_received");
        const receivedWantsEmail = !!(customer?.email && customerWantsEmail(customer, "ticket_received"));
        // Create the bell row whenever the customer would be notified through
        // any channel, so email-only customers still get an in-app entry; push
        // reuses the same row so push users still get exactly one (Task #352).
        let receivedNotifId: string | null = null;
        if (receivedWantsPush || receivedWantsEmail) {
          receivedNotifId = await createBellNotification(req.session.userId!, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id }, {
            title: "Ticket received",
            body: `We received: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
          });
        }
        if (receivedWantsPush) {
          void sendPushToUser(req.session.userId!, {
            title: "Ticket received",
            body: `We received: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
            tag: `ticket-${ticket.id}`,
            resourceLabel: `Ticket: ${ticket.subject}`,
            rollupNoun: "messages",
          }, receivedNotifId ? { notificationId: receivedNotifId } : { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
        }
        if (customerWantsInApp(customer, "ticket_reply")) {
          void storage.createTicketNotification({
            userId: req.session.userId!,
            ticketId: ticket.id,
            type: "ticket_reply",
            message: `New reply on: ${ticket.subject}`,
          });
        }
        if (customer?.email && customerWantsEmail(customer, "ticket_received")) {
          void sendTemplatedEmail(customer.email, "customer_ticket_received", {
            ticket_subject: ticket.subject,
            customer_name: customer.fullName,
          }, customer.fullName);
        }
      } catch (autoReplyErr) {
        console.error("Auto-reply error:", autoReplyErr);
      }

      res.json(ticket);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/tickets/:id", requireAuth, async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "admin" && user.role !== "master_admin" && ticket.customerId !== user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if ((user.role === "admin") && ticket.categoryId) {
        const accessibleIds = await getAdminCategoryAccess(user.id);
        if (!accessibleIds.includes("*") && !accessibleIds.includes(ticket.categoryId)) {
          return res.status(403).json({ message: "You don't have access to this ticket's category" });
        }
      }
      const { status, resolutionNote } = req.body;
      const data: any = { status };
      if (status === "closed") {
        data.closedAt = new Date();
        data.closedBy = req.session.userId;
        if ((user.role === "admin" || user.role === "master_admin") && (!resolutionNote || !resolutionNote.trim())) {
          return res.status(400).json({ message: "A resolution note is required when closing a ticket" });
        }
        if (resolutionNote && resolutionNote.trim()) data.resolutionNote = resolutionNote.trim();
      }
      const updated = await storage.updateTicket(getParam(req, "id"), data);
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      broadcast({ type: "ticket_updated", ticket: updated });
      const ticketCustomer = await storage.getUser(ticket.customerId);
      const customerName = ticketCustomer?.fullName || "Unknown";
      if (status === "closed") {
        logActivity("ticket", "ticket_closed", { actorId: req.session.userId!, targetId: ticket.id, targetType: "ticket", summary: `Ticket closed by ${user.fullName}: "${ticket.subject}" (customer: ${customerName})`, details: JSON.stringify({ customer: customerName, customerEmail: ticketCustomer?.email, subject: ticket.subject, closedBy: user.fullName, resolutionNote: data.resolutionNote }) });
      } else {
        logActivity("ticket", "ticket_updated", { actorId: req.session.userId!, targetId: ticket.id, targetType: "ticket", summary: `Ticket updated to ${status}: "${ticket.subject}" (customer: ${customerName})`, details: JSON.stringify({ customer: customerName, subject: ticket.subject, newStatus: status }) });
      }

      if (status === "closed") {
        try {
          let supportUser = await storage.getUserByUsername("cowboymedia-support");
          if (!supportUser) {
            supportUser = await storage.createUser({
              username: "cowboymedia-support",
              password: "nologin-system-account",
              email: "noreply@cowboymedia.net",
              fullName: "CowboyMedia Support",
              role: "admin",
              theme: "light",
            });
          }
          const closeMessage = await storage.createTicketMessage({
            ticketId: ticket.id,
            senderId: supportUser.id,
            message: "Your ticket has now been closed. Thank you for contacting CowboyMedia Support, have a great day!",
            imageUrl: null,
          });
          broadcast({ type: "ticket_message", ticketId: ticket.id, message: closeMessage });
        } catch (closeMsgErr) {
          console.error("Close message error:", closeMsgErr);
        }

        const customer = await storage.getUser(ticket.customerId);
        const allUsers = await storage.getAllUsers();
        let admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
        if (ticket.categoryId) {
          const category = await storage.getTicketCategory(ticket.categoryId);
          if (category && category.assignedRoleIds && category.assignedRoleIds.length > 0) {
            admins = admins.filter(a => a.role === "master_admin" || (a.adminRoleId && category.assignedRoleIds!.includes(a.adminRoleId)));
          }
        }

        const isAdminClose = user.role === "admin" || user.role === "master_admin";
        const closedByLabel = isAdminClose ? `${user.fullName} (Admin)` : `${user.fullName} (Customer)`;
        const openedDate = format(new Date(ticket.createdAt), "MMM d, yyyy 'at' h:mm a");
        const closedDate = format(new Date(), "MMM d, yyyy 'at' h:mm a");

        let conversationHtml = "";
        let resolutionHtml = "";
        try {
          // Close-transcript is emailed to the customer, so internal notes must be excluded.
          const allMessages = await storage.getTicketMessages(ticket.id, false);
          const senderIds = [...new Set(allMessages.map(m => m.senderId))];
          const senderMap = new Map<string, string>();
          await Promise.all(senderIds.map(async (id) => {
            const sender = await storage.getUser(id);
            if (sender) senderMap.set(id, sender.fullName);
          }));
          conversationHtml = allMessages.map(m => {
            const name = escapeHtml(senderMap.get(m.senderId) || "Unknown");
            const time = format(new Date(m.createdAt), "MMM d, yyyy 'at' h:mm a");
            const msgText = escapeHtml(m.message || "").replace(/\n/g, "<br/>");
            return `<div style="margin-bottom:12px;padding:8px;border-left:3px solid #e5e7eb;">
<p style="margin:0;font-size:13px;"><strong>${name}</strong> <span style="color:#6b7280;font-size:12px;">${time}</span></p>
<p style="margin:4px 0 0 0;font-size:14px;">${msgText}</p>
${m.imageUrl ? `<p style="margin:4px 0 0 0;"><a href="${escapeHtml(m.imageUrl)}" style="color:#3b82f6;font-size:12px;">View Attachment</a></p>` : ""}
</div>`;
          }).join("");

          if (isAdminClose) {
            resolutionHtml = `<div style="margin:16px 0;padding:12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
<h3 style="margin:0 0 8px 0;font-size:15px;color:#166534;">Resolution Summary</h3>
<p style="margin:0;font-size:14px;color:#15803d;">${escapeHtml(resolutionNote || "").replace(/\n/g, "<br/>")}</p>
</div>`;
          } else if (resolutionNote && resolutionNote.trim() && resolutionNote !== "Customer closed without providing a closing description") {
            resolutionHtml = `<div style="margin:16px 0;padding:12px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;">
<h3 style="margin:0 0 8px 0;font-size:15px;color:#1e40af;">Customer's Closing Note</h3>
<p style="margin:0;font-size:14px;color:#1d4ed8;">${escapeHtml(resolutionNote).replace(/\n/g, "<br/>")}</p>
</div>`;
          } else {
            resolutionHtml = `<div style="margin:16px 0;padding:12px;background:#fef3c7;border:1px solid #fcd34d;border-radius:6px;">
<h3 style="margin:0 0 8px 0;font-size:15px;color:#92400e;">Closing Note</h3>
<p style="margin:0;font-size:14px;color:#a16207;">Customer closed the ticket without providing a closing description.</p>
</div>`;
          }
        } catch (transcriptBuildErr) {
          console.error("Transcript build error:", transcriptBuildErr);
        }

        for (const admin of admins) {
          const adminQuiet = shouldSuppressNotification({ user: admin, categoryKey: "admin_ticket_closed" });
          if (!adminQuiet) {
            void sendPushToUser(admin.id, {
              title: "Ticket Closed",
              body: `Ticket Closed: ${ticket.subject}`,
              url: `/tickets/${ticket.id}`,
              tag: `ticket-${ticket.id}`,
              resourceLabel: `Ticket: ${ticket.subject}`,
              rollupNoun: "messages",
            }, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
          }
          void storage.createTicketNotification({
            userId: admin.id,
            ticketId: ticket.id,
            type: "ticket_closed",
            message: `Ticket closed: ${ticket.subject}`,
          });
          if (admin.email && customer && !adminQuiet) {
            void sendTemplatedEmail(admin.email, "admin_ticket_closed", {
              customer_name: customer.fullName,
              customer_username: customer.username,
              customer_email: customer.email || "",
              ticket_subject: ticket.subject,
              ticket_description: ticket.description,
              opened_date: openedDate,
              closed_date: closedDate,
              closed_by: closedByLabel,
              resolution_summary: resolutionHtml,
              conversation: conversationHtml,
            }, admin.fullName, new Set(["resolution_summary", "conversation"]));
          }
        }

        // ticket_closed is an email-only category (no push), but email-only
        // customers should still see it in the bell (Task #352).
        if (customer?.email && customerWantsEmail(customer, "ticket_closed")) {
          await createBellNotification(ticket.customerId, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id }, {
            title: "Ticket closed",
            body: `Closed: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
          });
          try {
            void sendTemplatedEmail(customer.email, "ticket_transcript", {
              ticket_subject: ticket.subject,
              ticket_description: ticket.description,
              customer_name: customer.fullName,
              opened_date: openedDate,
              closed_date: closedDate,
              resolution_summary: resolutionHtml,
              conversation: conversationHtml,
            }, customer.fullName, new Set(["resolution_summary", "conversation"]));
          } catch (transcriptErr) {
            console.error("Transcript email error:", transcriptErr);
          }
        }
      }

      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/tickets/:id/claim", requirePermission("support_tickets"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (ticket.claimedBy) {
        const claimedAdmin = await storage.getUser(ticket.claimedBy);
        return res.status(400).json({ message: `Ticket already claimed by ${claimedAdmin?.fullName || "another admin"}` });
      }
      const admin = await storage.getUser(req.session.userId!);
      if (!admin) return res.status(401).json({ message: "Unauthorized" });
      if (admin.role === "admin" && ticket.categoryId) {
        const accessibleCategoryIds = await getAdminCategoryAccess(admin.id);
        if (!accessibleCategoryIds.includes("*") && !accessibleCategoryIds.includes(ticket.categoryId)) {
          return res.status(403).json({ message: "No access to this ticket category" });
        }
      }

      const updated = await storage.updateTicket(getParam(req, "id"), { claimedBy: admin.id });
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      broadcast({ type: "ticket_updated", ticket: updated });
      const claimCustomer = await storage.getUser(ticket.customerId);
      logActivity("ticket", "ticket_claimed", { actorId: admin.id, targetId: ticket.id, targetType: "ticket", summary: `${admin.fullName} claimed ticket: "${ticket.subject}" (customer: ${claimCustomer?.fullName || "Unknown"})`, details: JSON.stringify({ admin: admin.fullName, customer: claimCustomer?.fullName, customerEmail: claimCustomer?.email, subject: ticket.subject }) });

      const pendingTransfer = await storage.getPendingTransferByTicketId(getParam(req, "id"));
      const isTransfer = pendingTransfer && pendingTransfer.toAdminId === admin.id;

      if (isTransfer) {
        await storage.updateTicketTransfer(pendingTransfer.id, { status: "accepted" });
      }

      try {
        let supportUser = await storage.getUserByUsername("cowboymedia-support");
        if (!supportUser) {
          supportUser = await storage.createUser({
            username: "cowboymedia-support",
            password: "nologin-system-account",
            email: "noreply@cowboymedia.net",
            fullName: "CowboyMedia Support",
            role: "admin",
            theme: "light",
          });
        }
        const claimMessage = isTransfer
          ? `Your ticket has been successfully transferred to ${admin.fullName} and they will be assisting you from here on out.`
          : `${admin.fullName} has claimed this ticket and will be assisting you.`;
        const autoMessage = await storage.createTicketMessage({
          ticketId: ticket.id,
          senderId: supportUser.id,
          message: claimMessage,
          imageUrl: null,
        });
        broadcast({ type: "ticket_message", ticketId: ticket.id, message: autoMessage });
      } catch (claimMsgErr) {
        console.error("Claim message error:", claimMsgErr);
      }

      const pushTitle = isTransfer ? "Ticket Transferred" : "Ticket Claimed";
      const pushBody = isTransfer
        ? `Your ticket has been transferred to ${admin.fullName}: ${ticket.subject}`
        : `${admin.fullName} is now handling your ticket: ${ticket.subject}`;

      const customer = await storage.getUser(ticket.customerId);
      const claimCategory = isTransfer ? "ticket_transferred" : "ticket_claimed";
      const claimWantsPush = customerWantsPush(customer, claimCategory);
      const claimWantsEmail = !!(customer?.email && customerWantsEmail(customer, claimCategory));
      let claimNotifId: string | null = null;
      if (claimWantsPush || claimWantsEmail) {
        claimNotifId = await createBellNotification(ticket.customerId, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id }, {
          title: pushTitle,
          body: pushBody,
          url: `/tickets/${ticket.id}`,
        });
      }
      if (claimWantsPush) {
        void sendPushToUser(ticket.customerId, {
          title: pushTitle,
          body: pushBody,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
        }, claimNotifId ? { notificationId: claimNotifId } : { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
      }
      if (customerWantsInApp(customer, claimCategory)) {
        void storage.createTicketNotification({
          userId: ticket.customerId,
          ticketId: ticket.id,
          type: isTransfer ? "ticket_transferred" : "ticket_claimed",
          message: isTransfer
            ? `Your ticket has been transferred to ${admin.fullName}: ${ticket.subject}`
            : `${admin.fullName} claimed your ticket: ${ticket.subject}`,
        });
      }

      if (customer?.email && customerWantsEmail(customer, claimCategory)) {
        const emailTemplate = isTransfer ? "customer_ticket_transferred" : "customer_ticket_claimed";
        void sendTemplatedEmail(customer.email, emailTemplate, {
          admin_name: admin.fullName,
          ticket_subject: ticket.subject,
          customer_name: customer.fullName,
        }, customer.fullName);
      }

      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/tickets/:id/transfer", requirePermission("support_tickets"), async (req, res) => {
    try {
      const { toAdminId, reason } = req.body;
      if (!toAdminId || !reason) return res.status(400).json({ message: "Target admin and reason are required" });
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const admin = await storage.getUser(req.session.userId!);
      if (!admin) return res.status(401).json({ message: "Unauthorized" });
      if (ticket.claimedBy !== admin.id && admin.role !== "master_admin") {
        return res.status(403).json({ message: "Only the claiming admin can transfer this ticket" });
      }
      const targetAdmin = await storage.getUser(toAdminId);
      if (!targetAdmin || (targetAdmin.role !== "admin" && targetAdmin.role !== "master_admin")) {
        return res.status(400).json({ message: "Target must be an admin" });
      }

      const transfer = await storage.createTicketTransfer({
        ticketId: ticket.id,
        fromAdminId: admin.id,
        toAdminId,
        reason,
      });
      const transferCustomer = await storage.getUser(ticket.customerId);
      logActivity("ticket", "ticket_transferred", { actorId: admin.id, targetId: ticket.id, targetType: "ticket", recipientId: toAdminId, summary: `${admin.fullName} transferred ticket "${ticket.subject}" to ${targetAdmin.fullName} (customer: ${transferCustomer?.fullName || "Unknown"})`, details: JSON.stringify({ reason, fromAdmin: admin.fullName, toAdmin: targetAdmin.fullName, customer: transferCustomer?.fullName, customerEmail: transferCustomer?.email }) });

      await storage.updateTicket(getParam(req, "id"), { claimedBy: null });

      try {
        let supportUser = await storage.getUserByUsername("cowboymedia-support");
        if (!supportUser) {
          supportUser = await storage.createUser({
            username: "cowboymedia-support",
            password: "nologin-system-account",
            email: "noreply@cowboymedia.net",
            fullName: "CowboyMedia Support",
            role: "admin",
            theme: "light",
          });
        }
        const transferMsg = "Your ticket requires the assistance of another support agent. Please hold while we alert the appropriate department and transfer the ticket. We will send you a push notification/email (depending on your settings) when your ticket has been transferred and agent is ready to help. Thank you for your patience!";
        const autoMessage = await storage.createTicketMessage({
          ticketId: ticket.id,
          senderId: supportUser.id,
          message: transferMsg,
          imageUrl: null,
        });
        broadcast({ type: "ticket_message", ticketId: ticket.id, message: autoMessage });
      } catch (msgErr) {
        console.error("Transfer message error:", msgErr);
      }

      broadcast({ type: "ticket_updated", ticket: { ...ticket, claimedBy: null } });

      const customer = await storage.getUser(ticket.customerId);
      const services = await storage.getAllServices();
      const service = services.find(s => s.id === ticket.serviceId);
      const categories = await storage.getAllTicketCategories();
      const category = categories.find(c => c.id === ticket.categoryId);

      if (!shouldSuppressNotification({ user: targetAdmin, categoryKey: "ticket_transferred" })) {
        void sendPushToUser(toAdminId, {
          title: "Ticket Transfer",
          body: `${admin.fullName} transferred a ticket to you: ${ticket.subject} — Reason: ${reason}`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-transfer-${ticket.id}`,
        }, { type: "ticket_transfer", referenceType: "ticket", referenceId: ticket.id });
      }

      void storage.createTicketNotification({
        userId: toAdminId,
        ticketId: ticket.id,
        type: "ticket_transfer",
        message: `Ticket transferred from ${admin.fullName}: ${ticket.subject}`,
      });

      if (targetAdmin.email && customerWantsEmail(targetAdmin, "ticket_transferred")) {
        void sendTemplatedEmail(targetAdmin.email, "admin_ticket_transfer", {
          from_admin_name: admin.fullName,
          transfer_reason: reason,
          ticket_subject: ticket.subject,
          ticket_description: ticket.description,
          ticket_priority: ticket.priority,
          customer_name: customer?.fullName || "Unknown",
          customer_email: customer?.email || "N/A",
        }, targetAdmin.fullName);
      }

      broadcast({
        type: "ticket_transfer",
        transfer,
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          description: ticket.description,
          priority: ticket.priority,
          serviceName: service?.name || null,
          categoryName: category?.name || null,
          createdAt: ticket.createdAt,
        },
        customer: {
          fullName: customer?.fullName || "Unknown",
          email: customer?.email || "N/A",
          username: customer?.username || "Unknown",
        },
        fromAdmin: { fullName: admin.fullName },
      });

      res.json(transfer);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/ticket-transfers/pending", requirePermission("support_tickets"), async (req, res) => {
    try {
      const transfers = await storage.getPendingTransfersForAdmin(req.session.userId!);
      const enriched = await Promise.all(transfers.map(async (t) => {
        const ticket = await storage.getTicket(t.ticketId);
        const customer = ticket ? await storage.getUser(ticket.customerId) : null;
        const fromAdmin = await storage.getUser(t.fromAdminId);
        const services = await storage.getAllServices();
        const service = ticket ? services.find(s => s.id === ticket.serviceId) : null;
        const categories = await storage.getAllTicketCategories();
        const category = ticket ? categories.find(c => c.id === ticket.categoryId) : null;
        return {
          ...t,
          ticket: ticket ? {
            id: ticket.id,
            subject: ticket.subject,
            description: ticket.description,
            priority: ticket.priority,
            serviceName: service?.name || null,
            categoryName: category?.name || null,
            createdAt: ticket.createdAt,
          } : null,
          customer: customer ? {
            fullName: customer.fullName,
            email: customer.email,
            username: customer.username,
          } : null,
          fromAdmin: { fullName: fromAdmin?.fullName || "Unknown" },
        };
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/support-admins", requirePermission("support_tickets"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const admins = allUsers
        .filter(u => (u.role === "admin" || u.role === "master_admin") && u.id !== req.session.userId)
        .map(u => ({ id: u.id, fullName: u.fullName }));
      res.json(admins);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/tickets/:id/messages", requireAuth, async (req, res) => {
   try {
    const ticket = await storage.getTicket(getParam(req, "id"));
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role !== "admin" && user.role !== "master_admin" && ticket.customerId !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    if (user.role === "admin" && ticket.categoryId) {
      const accessibleCategoryIds = await getAdminCategoryAccess(user.id);
      if (!accessibleCategoryIds.includes("*") && !accessibleCategoryIds.includes(ticket.categoryId)) {
        return res.status(403).json({ message: "No access to this ticket category" });
      }
    }
    if (user.role === "admin" && ticket.claimedBy && ticket.claimedBy !== user.id) {
      const pendingTransfer = await storage.getPendingTransferByTicketId(ticket.id);
      if (!pendingTransfer || pendingTransfer.toAdminId !== user.id) {
        return res.status(403).json({ message: "This ticket is claimed by another admin" });
      }
    }
    const isCustomer = user.role === "customer";
    const includeInternal = !isCustomer;
    const messages = await storage.getTicketMessages(getParam(req, "id"), includeInternal);
    if (isCustomer) {
      const hasUnread = messages.some(m => m.senderId !== user.id && !m.readAt);
      if (hasUnread) {
        await storage.markTicketMessagesRead(getParam(req, "id"), user.id);
        const updatedMessages = await storage.getTicketMessages(getParam(req, "id"), false);
        const senderIds = [...new Set(updatedMessages.map(m => m.senderId))];
        const senderMap = new Map<string, { name: string; role: string; avatarUrl: string | null }>();
        await Promise.all(senderIds.map(async (id) => {
          const sender = await storage.getUser(id);
          if (sender) senderMap.set(id, { name: sender.fullName, role: sender.role, avatarUrl: sender.avatarUrl || null });
        }));
        const kbBySlug = await enrichKbArticlesForMessages(updatedMessages, storage);
        const enriched = updatedMessages.map(m => ({
          ...m,
          senderName: senderMap.get(m.senderId)?.name || "Unknown",
          senderRole: senderMap.get(m.senderId)?.role || "customer",
          senderAvatarUrl: senderMap.get(m.senderId)?.avatarUrl || null,
          kbArticle: m.kbArticleSlug ? kbBySlug.get(m.kbArticleSlug) ?? null : null,
        }));
        broadcast({ type: "ticket_messages_read", ticketId: req.params.id, readBy: user.id });
        return res.json(enriched);
      }
    }
    const senderIds = [...new Set(messages.map(m => m.senderId))];
    const senderMap = new Map<string, { name: string; role: string; avatarUrl: string | null }>();
    await Promise.all(senderIds.map(async (id) => {
      const sender = await storage.getUser(id);
      if (sender) senderMap.set(id, { name: sender.fullName, role: sender.role, avatarUrl: sender.avatarUrl || null });
    }));
    const kbBySlug = await enrichKbArticlesForMessages(messages, storage);
    const enriched = messages.map(m => ({
      ...m,
      senderName: senderMap.get(m.senderId)?.name || "Unknown",
      senderRole: senderMap.get(m.senderId)?.role || "customer",
      senderAvatarUrl: senderMap.get(m.senderId)?.avatarUrl || null,
      kbArticle: m.kbArticleSlug ? kbBySlug.get(m.kbArticleSlug) ?? null : null,
    }));
    res.json(enriched);
   } catch (e) {
     if (getErrorCode(e) === "22P02") return res.status(404).json({ message: "Ticket not found" });
     throw e;
   }
  });

  app.get("/api/admin/customers/:customerId/tickets", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const customerTickets = await storage.getTicketsByCustomer(getParam(req, "customerId"));
      const excludeId = queryString(req.query.excludeTicketId);
      let filtered = excludeId ? customerTickets.filter(t => t.id !== excludeId) : customerTickets;
      if (user.role === "admin") {
        const accessibleIds = await getAdminCategoryAccess(user.id);
        if (!accessibleIds.includes("*")) {
          filtered = filtered.filter(t => !t.categoryId || accessibleIds.includes(t.categoryId));
        }
      }
      const categories = await storage.getAllTicketCategories();
      const categoryMap = new Map(categories.map(c => [c.id, c.name]));
      const result = filtered.map(t => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        resolutionNote: t.resolutionNote,
        closedBy: t.closedBy,
        categoryId: t.categoryId,
        categoryName: t.categoryId ? categoryMap.get(t.categoryId) || null : null,
        createdAt: t.createdAt,
        closedAt: t.closedAt,
      }));
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/tickets/:id/customer", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const customer = await storage.getUser(ticket.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const { password: _, emailNotifications: __, ...safeCustomer } = customer;
      res.json({
        customer: {
          id: safeCustomer.id,
          username: safeCustomer.username,
          email: safeCustomer.email,
          fullName: safeCustomer.fullName,
          role: safeCustomer.role,
        },
        ticket: {
          id: ticket.id,
          subject: ticket.subject,
          description: ticket.description,
          serviceId: ticket.serviceId,
          status: ticket.status,
          priority: ticket.priority,
          createdAt: ticket.createdAt,
          closedAt: ticket.closedAt,
          imageUrl: ticket.imageUrl,
        },
      });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/tickets/:id/messages", requireAuth, withUpload("image"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const isAdmin = user.role === "admin" || user.role === "master_admin";
      if (!isAdmin && ticket.customerId !== user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "admin" && ticket.categoryId) {
        const accessibleCategoryIds = await getAdminCategoryAccess(user.id);
        if (!accessibleCategoryIds.includes("*") && !accessibleCategoryIds.includes(ticket.categoryId)) {
          return res.status(403).json({ message: "No access to this ticket category" });
        }
      }
      if (user.role === "admin" && !ticket.claimedBy) {
        return res.status(400).json({ message: "You must claim this ticket before responding" });
      }
      if (user.role === "admin" && ticket.claimedBy !== user.id) {
        return res.status(403).json({ message: "Only the admin who claimed this ticket can respond" });
      }
      const requestedInternal = parseIsInternalFlag(req.body.isInternal);
      if (requestedInternal && !canPostInternalNote(user.role)) {
        return res.status(403).json({ message: "Only admins can post internal notes" });
      }
      const isInternal = requestedInternal && canPostInternalNote(user.role);
      // Optional KB article attachment. Anyone in the conversation
      // (customer or admin) can link a published article — KB content is
      // already visible to all signed-in users via /knowledge.
      const rawKbSlug = typeof req.body?.kbArticleSlug === "string" ? req.body.kbArticleSlug.trim() : "";
      let kbArticleSlug: string | null = null;
      let kbArticleInfo: KbArticleEnvelope | null = null;
      if (rawKbSlug.length > 0) {
        const resolved = await resolveKbArticleAttachment(rawKbSlug, storage);
        if (!resolved.ok) {
          return res.status(resolved.status).json({ message: resolved.error });
        }
        kbArticleSlug = resolved.slug;
        kbArticleInfo = resolved.info;
      }
      if (user.role === "master_admin" && ticket.claimedBy && ticket.claimedBy !== user.id) {
        const existingMessages = await storage.getTicketMessages(getParam(req, "id"), true);
        const joinedMessage = `${user.fullName} has joined the conversation`;
        const alreadyJoined = existingMessages.some(m => m.message === joinedMessage);
        if (!alreadyJoined) {
          let supportUser = await storage.getUserByUsername("cowboymedia-support");
          if (!supportUser) {
            supportUser = await storage.createUser({
              username: "cowboymedia-support",
              password: "nologin-system-account",
              email: "noreply@cowboymedia.net",
              fullName: "CowboyMedia Support",
              role: "admin",
              theme: "light",
            });
          }
          const joinMsg = await storage.createTicketMessage({
            ticketId: ticket.id,
            senderId: supportUser.id,
            message: joinedMessage,
            imageUrl: null,
          });
          broadcast({ type: "ticket_message", ticketId: ticket.id, message: joinMsg });
        }
      }
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const rawMessage = typeof req.body.message === "string" ? req.body.message : "";
      // Message body may be empty when a KB article is the sole payload (parity
      // with how the existing image-only path is handled implicitly elsewhere).
      if (!rawMessage.trim() && !imageUrl && !kbArticleSlug) {
        return res.status(400).json({ message: "Message is required" });
      }
      const message = await storage.createTicketMessage({
        ticketId: getParam(req, "id"),
        senderId: req.session.userId!,
        message: rawMessage,
        imageUrl: imageUrl || null,
        isInternal,
        kbArticleSlug,
      });
      const messageWithKb = { ...message, kbArticle: kbArticleInfo };
      const msgCustomer = isAdmin ? await storage.getUser(ticket.customerId) : user;
      if (isInternal) {
        logActivity("ticket", "ticket_internal_note_created", {
          actorId: req.session.userId!,
          targetId: ticket.id,
          targetType: "ticket",
          summary: `Internal note added by ${user.fullName} on ticket "${ticket.subject}"`,
          details: JSON.stringify({ messageId: message.id, sender: user.fullName, customer: msgCustomer?.fullName, subject: ticket.subject, body: req.body.message }),
        });
        broadcastToAdmins({ type: "ticket_message", ticketId: req.params.id, message: messageWithKb, isInternal: true });
        const allAdminUsers = await storage.getAllUsers();
        let admins = allAdminUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support" && u.id !== req.session.userId);
        if (ticket.categoryId) {
          const category = await storage.getTicketCategory(ticket.categoryId);
          if (category && category.assignedRoleIds && category.assignedRoleIds.length > 0) {
            admins = admins.filter(a => a.role === "master_admin" || (a.adminRoleId && category.assignedRoleIds!.includes(a.adminRoleId)));
          }
        }
        for (const admin of admins) {
          const adminViewingTicket = isUserViewingTicket(admin.id, ticket.id);
          if (adminWantsPush(admin, "admin_internal_note")) {
            void sendPushToUser(admin.id, {
              title: "Internal note",
              body: `${user.fullName} on: ${ticket.subject}`,
              url: `/admin?tab=support-tickets&ticket=${ticket.id}`,
              tag: `ticket-${ticket.id}`,
            }, adminViewingTicket ? undefined : { type: "ticket_internal_note", referenceType: "ticket", referenceId: ticket.id });
          }
        }
        return res.json(messageWithKb);
      }
      logActivity("ticket", "ticket_message", { actorId: req.session.userId!, targetId: ticket.id, targetType: "ticket", summary: `Message on ticket "${ticket.subject}" by ${user.fullName} (customer: ${msgCustomer?.fullName || "Unknown"})`, details: JSON.stringify({ sender: user.fullName, customer: msgCustomer?.fullName, subject: ticket.subject }) });
      broadcast({ type: "ticket_message", ticketId: req.params.id, message: messageWithKb });
      if (isAdmin) {
        const customerViewingTicket = isUserViewingTicket(ticket.customerId, ticket.id);
        const customer = await storage.getUser(ticket.customerId);
        const replyWantsPush = customerWantsPush(customer, "ticket_reply");
        const replyWantsEmail = !!(customer?.email && customerWantsEmail(customer, "ticket_reply"));
        // Bell row only when the customer isn't already viewing the ticket
        // (matches the existing push/notification suppression), but created for
        // email-only customers too so they get an in-app entry (Task #352).
        let replyNotifId: string | null = null;
        if (!customerViewingTicket && (replyWantsPush || replyWantsEmail)) {
          replyNotifId = await createBellNotification(ticket.customerId, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id }, {
            title: "New Ticket Reply",
            body: `Reply on: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
          });
        }
        if (replyWantsPush) {
          void sendPushToUser(ticket.customerId, {
            title: "New Ticket Reply",
            body: `Reply on: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
            tag: `ticket-${ticket.id}`,
            resourceLabel: `Ticket: ${ticket.subject}`,
            rollupNoun: "replies",
          }, customerViewingTicket ? undefined : (replyNotifId ? { notificationId: replyNotifId } : { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id }));
        }
        if (!customerViewingTicket && customerWantsInApp(customer, "ticket_reply")) {
          void storage.createTicketNotification({
            userId: ticket.customerId,
            ticketId: ticket.id,
            type: "ticket_reply",
            message: `New reply on: ${ticket.subject}`,
          });
        }
        if (customer?.email && customerWantsEmail(customer, "ticket_reply") && !isUserViewingTicket(ticket.customerId, ticket.id)) {
          if (shouldSendTicketEmail(ticket.customerId, ticket.id)) {
            recordTicketEmailSent(ticket.customerId, ticket.id);
            void sendTemplatedEmail(customer.email, "customer_ticket_reply", {
              ticket_subject: ticket.subject,
              message: req.body.message,
              customer_name: customer.fullName,
            }, customer.fullName);
          } else {
            console.log(`[Email Cooldown] Skipped ticket reply email to customer ${customer.fullName} for ticket ${ticket.id} (cooldown active)`);
          }
        }
      } else {
        const allAdminUsers = await storage.getAllUsers();
        let admins = allAdminUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
        if (ticket.categoryId) {
          const category = await storage.getTicketCategory(ticket.categoryId);
          if (category && category.assignedRoleIds && category.assignedRoleIds.length > 0) {
            admins = admins.filter(a => a.role === "master_admin" || (a.adminRoleId && category.assignedRoleIds!.includes(a.adminRoleId)));
          }
        }
        for (const admin of admins) {
          const adminViewingTicket = isUserViewingTicket(admin.id, ticket.id);
          const isAssignee = !!ticket.claimedBy && ticket.claimedBy === admin.id;
          const wantsMine = isAssignee && adminWantsPush(admin, "admin_ticket_reply_mine");
          const wantsAny = adminWantsPush(admin, "admin_ticket_reply_any");
          if (wantsMine || wantsAny) {
            void sendPushToUser(admin.id, {
              title: "New Ticket Message",
              body: `${user.fullName}: ${ticket.subject}`,
              url: `/admin?tab=support-tickets&ticket=${ticket.id}`,
              tag: `ticket-${ticket.id}`,
              resourceLabel: `Ticket: ${ticket.subject}`,
              rollupNoun: "replies",
            }, adminViewingTicket ? undefined : { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
          }
          if (!adminViewingTicket) {
            void storage.createTicketNotification({
              userId: admin.id,
              ticketId: ticket.id,
              type: "ticket_reply",
              message: `${user.fullName} replied: ${ticket.subject}`,
            });
          }
          if (admin.email && !isUserViewingTicket(admin.id, ticket.id) && !shouldSuppressNotification({ user: admin, categoryKey: isAssignee ? "admin_ticket_reply_mine" : "admin_ticket_reply_any" })) {
            if (shouldSendTicketEmail(admin.id, ticket.id)) {
              recordTicketEmailSent(admin.id, ticket.id);
              void sendTemplatedEmail(admin.email, "admin_ticket_reply", {
                customer_name: user.fullName,
                customer_username: user.username,
                ticket_subject: ticket.subject,
                message: req.body.message,
              }, admin.fullName);
            } else {
              console.log(`[Email Cooldown] Skipped ticket reply email to admin ${admin.fullName} for ticket ${ticket.id} (cooldown active)`);
            }
          }
        }
      }
      res.json(messageWithKb);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/tickets/:id/messages/:messageId", requireAdmin, async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const msg = await storage.getTicketMessage(getParam(req, "messageId"));
      const actor = await storage.getUser(req.session.userId!);
      const check = canMutateInternalNote(msg, ticket.id, actor);
      if (!check.ok) return res.status(check.status).json({ message: check.message });
      const newText = typeof req.body.message === "string" ? req.body.message.trim() : "";
      if (!newText) return res.status(400).json({ message: "Message cannot be empty" });
      const updated = await storage.updateTicketMessage(getParam(req, "messageId"), { message: newText });
      logActivity("ticket", "ticket_internal_note_edited", {
        actorId: req.session.userId!,
        targetId: ticket.id,
        targetType: "ticket",
        summary: `Internal note edited by ${actor?.fullName || "admin"} on ticket "${ticket.subject}"`,
        details: JSON.stringify({ messageId: msg!.id, before: msg!.message, after: newText }),
      });
      broadcastToAdmins({ type: "ticket_message_edited", ticketId: ticket.id, message: updated, isInternal: true });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/tickets/:id/messages/:messageId", requireAdmin, async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const msg = await storage.getTicketMessage(getParam(req, "messageId"));
      const actor = await storage.getUser(req.session.userId!);
      const check = canMutateInternalNote(msg, ticket.id, actor);
      if (!check.ok) return res.status(check.status).json({ message: check.message });
      await storage.deleteTicketMessage(getParam(req, "messageId"));
      await deleteUploadedFileIfUnreferenced(msg!.imageUrl);
      logActivity("ticket", "ticket_internal_note_deleted", {
        actorId: req.session.userId!,
        targetId: ticket.id,
        targetType: "ticket",
        summary: `Internal note deleted by ${actor?.fullName || "admin"} on ticket "${ticket.subject}"`,
        details: JSON.stringify({ messageId: msg!.id, body: msg!.message }),
      });
      broadcastToAdmins({ type: "ticket_message_deleted", ticketId: ticket.id, messageId: msg!.id });
      res.json({ message: "Deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Admin routes
  app.get("/api/admin/users", requirePermission("users.view", "users.manage"), async (_req, res) => {
    const result = await storage.getAllUsers();
    res.json(result.map((u) => ({ ...sanitizeUser(u), totpEnabled: !!u.totpEnabledAt })));
  });

  app.get("/api/admin/users/push-status", requirePermission("users.view", "users.manage"), async (_req, res) => {
    try {
      const allSubs = await storage.getAllPushSubscriptions();
      const userIdsWithPush = new Set(allSubs.map(s => s.userId));
      const status: Record<string, boolean> = {};
      for (const uid of userIdsWithPush) {
        status[uid] = true;
      }
      res.json(status);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/users", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const username = req.body.username?.trim();
      const fullName = req.body.fullName?.trim();
      const { password, email, role } = req.body;
      const existing = await storage.getUserByUsername(username);
      if (existing) return res.status(400).json({ message: "Username already taken" });
      const hashed = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashed, email, fullName, role: role || "customer", theme: "light" });
      res.json(sanitizeUser(user));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/users/:id", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const { emailNotifications: _ignoredEmailNotifications, ...data } = req.body ?? {};
      if (data.username) data.username = data.username.trim();
      if (data.fullName) data.fullName = data.fullName.trim();
      const updated = await storage.updateUser(getParam(req, "id"), data);
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/users/:id/password", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const hashed = await hashPassword(password);
      const updated = await storage.updateUser(getParam(req, "id"), { password: hashed });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ message: "Password reset successfully" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/users/:id", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      await storage.deleteUser(getParam(req, "id"));
      res.json({ message: "User deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/services", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      const service = await storage.createService(req.body);
      res.json(service);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/services/:id", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      const existing = await storage.getService(getParam(req, "id"));
      if (!existing) return res.status(404).json({ message: "Service not found" });
      const updated = await storage.updateService(getParam(req, "id"), req.body);
      if (!updated) return res.status(404).json({ message: "Service not found" });
      if (req.body.status && req.body.status !== existing.status) {
        const allUsers = await storage.getAllUsers();
        const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(existing.id));
        const inAppIds = subscribedCustomers.filter(u => customerWantsInApp(u, "service_status")).map(u => u.id);
        for (const u of subscribedCustomers) {
          const statusWantsPush = customerWantsPush(u, "service_status");
          const statusWantsEmail = !!(u.email && customerWantsEmail(u, "service_status"));
          let statusNotifId: string | null = null;
          if (statusWantsPush || statusWantsEmail) {
            statusNotifId = await createBellNotification(u.id, { type: "service_status", referenceType: "service", referenceId: updated.id }, {
              title: "Service Status Update",
              body: `${updated.name}: ${updated.status}`,
              url: "/services",
            });
          }
          if (statusWantsPush) {
            void sendPushToUser(u.id, {
              title: "Service Status Update",
              body: `${updated.name}: ${updated.status}`,
              url: "/services",
              tag: `service-${updated.id}`,
            }, statusNotifId ? { notificationId: statusNotifId } : { type: "service_status", referenceType: "service", referenceId: updated.id });
          }
          if (u.email && customerWantsEmail(u, "service_status")) {
            void sendTemplatedEmail(u.email, "customer_service_status", {
              service_name: updated.name,
              service_status: updated.status,
              customer_name: u.fullName,
            }, u.fullName);
          }
        }
        storage.createContentNotificationBulk(inAppIds, "services", `${updated.name}: ${updated.status}`, updated.id).catch(() => {});
      }
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/services/:id", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      await storage.deleteService(getParam(req, "id"));
      res.json({ message: "Service deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Service-alert admin routes (create / edit / add-update / edit-update /
  // resolve / delete) live in server/alert-routes.ts so they can be mounted on a
  // bare Express app and tested over HTTP. Collaborators are injected so the
  // recompute + broadcast orchestration is exercised at the route boundary.
  registerAlertRoutes(
    app,
    { requirePermission, upload },
    {
      storage,
      broadcast,
      saveUploadedFile,
      parseServiceIds,
      logActivity,
      customerWantsPush,
      customerWantsEmail,
      customerWantsInApp,
      sendPushToUser,
      sendTemplatedEmail,
      fireDiscordForServices,
      fireTelegram,
      getBaseUrl,
      notifyServiceSubscribers,
    },
  );

  app.get("/api/service-updates", requireAuth, async (req, res) => {
    try {
      const updates = await storage.getAllServiceUpdates();
      const user = await storage.getUser(req.session.userId!);
      if (user && user.role !== "admin" && user.role !== "master_admin") {
        const hiddenIds = await storage.getHiddenServiceUpdateIds(user.id);
        const filtered = updates.filter(u => !hiddenIds.includes(u.id));
        return res.json(filtered);
      }
      res.json(updates);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/service-updates", requirePermission("service_updates.view", "service_updates.manage"), async (req, res) => {
    try {
      const parsed = insertServiceUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Title, description, and serviceId are required" });
      }
      const { title, description, serviceId, matureContent } = parsed.data;
      const update = await storage.createServiceUpdate({ title, description, serviceId, matureContent: matureContent ?? false });
      const service = await storage.getService(serviceId);
      const serviceName = service?.name || "Unknown Service";
      logActivity("service_update", "service_update_created", { actorId: req.session.userId!, targetId: update.id, targetType: "service_update", summary: `Service update created: ${title} (${serviceName})`, details: JSON.stringify({ title, description, service: serviceName }) });
      broadcast({ type: "new_service_update", update });

      const allUsers = await storage.getAllUsers();
      const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(serviceId));
      for (const u of subscribedCustomers) {
        const updateWantsPush = customerWantsPush(u, "service_update");
        const updateWantsEmail = !!(u.email && customerWantsEmail(u, "service_update"));
        let updateNotifId: string | null = null;
        if (updateWantsPush || updateWantsEmail) {
          updateNotifId = await createBellNotification(u.id, { type: "service_update", referenceType: "service_update_group", referenceId: serviceId }, {
            title: `Service Update: ${serviceName}`,
            body: title,
            url: "/service-updates",
          });
        }
        if (updateWantsPush) {
          void sendPushToUser(u.id, {
            title: `Service Update: ${serviceName}`,
            body: title,
            url: "/service-updates",
            tag: `service-update-${serviceId}`,
            resourceLabel: serviceName,
            rollupNoun: "updates",
            // Group key matches the OS toast `tag` (service-update-<serviceId>)
            // so PATCH /api/notifications/:id/read sweeps every unread peer
            // for the same service in one go.
          }, updateNotifId ? { notificationId: updateNotifId } : { type: "service_update", referenceType: "service_update_group", referenceId: serviceId });
        }
        if (u.email && customerWantsEmail(u, "service_update")) {
          void sendTemplatedEmail(u.email, "customer_service_update", {
            service_name: serviceName,
            update_title: title,
            update_description: description,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const inAppIds = subscribedCustomers.filter(u => customerWantsInApp(u, "service_update")).map(u => u.id);
      storage.createContentNotificationBulk(inAppIds, "service-updates", title, update.id).catch(() => {});
      fireDiscord(composeDiscordServiceUpdate({ serviceName, title, description, baseUrl: getBaseUrl(req) }), "service_update", service?.discordWebhookUrl);
      fireTelegram(composeServiceUpdate({ serviceName, title, description }), "service_update");
      res.json(update);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/service-updates/:id", requirePermission("service_updates.view", "service_updates.manage"), async (req, res) => {
    try {
      const { title, description, matureContent } = req.body;
      const data: Partial<{ title: string; description: string; matureContent: boolean }> = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (matureContent !== undefined) data.matureContent = matureContent;
      const updated = await storage.updateServiceUpdate(getParam(req, "id"), data);
      if (!updated) return res.status(404).json({ message: "Service update not found" });
      logActivity("service_update", "service_update_edited", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "service_update", summary: `Service update edited: ${updated.title}` });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/service-updates/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user && (user.role === "admin" || user.role === "master_admin")) {
        if (req.body?.hideOnly) {
          await storage.hideServiceUpdate(req.session.userId!, getParam(req, "id"));
          return res.json({ message: "Service update hidden for you" });
        }
        await storage.deleteServiceUpdate(getParam(req, "id"));
        logActivity("service_update", "service_update_deleted", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "service_update", summary: `Service update deleted` });
        return res.json({ message: "Service update deleted" });
      }
      await storage.hideServiceUpdate(req.session.userId!, getParam(req, "id"));
      res.json({ message: "Service update hidden" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/news", requirePermission("news.view", "news.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const story = await storage.createNewsStory({
        title: req.body.title,
        content: sanitizeNewsContent(req.body.content),
        imageUrl: imageUrl || null,
        authorId: req.session.userId!,
      });
      logActivity("news", "news_created", { actorId: req.session.userId!, targetId: story.id, targetType: "news", summary: `News story created: ${story.title}`, details: JSON.stringify({ title: story.title, content: story.content?.substring(0, 200) }) });
      broadcast({ type: "new_news", story });
      const allUsers = await storage.getAllUsers();
      const author = await storage.getUser(story.authorId);
      const authorLabel = author?.fullName || "News";
      for (const u of selectNewsPushRecipients(allUsers)) {
        void sendPushToUser(u.id, {
          title: "New News Story",
          body: story.title,
          url: `/news/${story.id}`,
          tag: `news-${story.authorId}`,
          resourceLabel: authorLabel,
          rollupNoun: "stories",
          // Group key matches the OS toast `tag` (news-<authorId>) so a
          // single mark-read sweeps every unread story by this author.
        }, { type: "news", referenceType: "news_author", referenceId: story.authorId });
      }
      const newsEmails = selectNewsEmailRecipients(allUsers);
      if (newsEmails.length > 0) {
        const plainContent = sanitizeHtml(story.content, { allowedTags: [], allowedAttributes: {} }).trim();
        const emailPreview = plainContent.length > 500 ? plainContent.substring(0, 500) + "..." : plainContent;
        void sendTemplatedEmail(newsEmails, "customer_news", {
          story_title: story.title,
          story_content: emailPreview,
        }, "Customers");
      }
      const newsRecipientIds = selectNewsInAppRecipients(allUsers);
      storage.createContentNotificationBulk(newsRecipientIds, "news", story.title, story.id).catch(() => {});
      fireDiscordMany(composeDiscordNews({ title: story.title, content: story.content || "", newsId: story.id, baseUrl: getBaseUrl(req) }), "news");
      fireTelegramMany(composeNews({ title: story.title, content: story.content || "" }), "news");
      res.json(story);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/news/:id", requirePermission("news.view", "news.manage"), withUpload("image"), async (req, res) => {
    try {
      const existing = await storage.getNewsStory(getParam(req, "id"));
      if (!existing) return res.status(404).json({ message: "News story not found" });

      const updateData: any = {};
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.content !== undefined) updateData.content = sanitizeNewsContent(req.body.content);
      if (req.file) {
        updateData.imageUrl = await saveUploadedFile(req.file);
      } else if (req.body.removeImage === "true") {
        updateData.imageUrl = null;
      }

      const updated = await storage.updateNewsStory(getParam(req, "id"), updateData);
      logActivity("news", "news_edited", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "news", summary: `News story edited: ${updated?.title || getParam(req, "id")}` });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/news/:id", requirePermission("news.view", "news.manage"), async (req, res) => {
    try {
      const storyToDelete = await storage.getNewsStory(getParam(req, "id"));
      await storage.deleteNewsStory(getParam(req, "id"));
      logActivity("news", "news_deleted", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "news", summary: `News story deleted: ${storyToDelete?.title || getParam(req, "id")}` });
      res.json({ message: "News story deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/upload-inline-image", requirePermission("news.view", "news.manage"), withUpload("image"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No image provided" });
      const url = await saveUploadedFile(req.file);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Delete ticket route (admin only)
  app.delete("/api/admin/tickets/:id", requirePermission("support_tickets"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (ticket.status !== "closed") {
        return res.status(400).json({ message: "Only closed tickets can be deleted" });
      }
      // Capture attached image URLs (the ticket's own + every message's) BEFORE
      // the rows are gone, then tidy up any upload no longer referenced once the
      // ticket + its messages are deleted.
      const ticketImageUrls = [
        ticket.imageUrl,
        ...(await storage.getTicketMessages(getParam(req, "id"), true)).map((m) => m.imageUrl),
      ].filter((u): u is string => !!u);
      await storage.deleteTicket(getParam(req, "id"));
      for (const url of ticketImageUrls) {
        await deleteUploadedFileIfUnreferenced(url);
      }
      res.json({ message: "Ticket deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Private messages routes
  app.post("/api/admin/private-messages", requirePermission("messages.view", "messages.manage"), async (req, res) => {
    try {
      const { recipientId, subject, body } = req.body;
      if (!recipientId || !subject || !body) {
        return res.status(400).json({ message: "recipientId, subject, and body are required" });
      }
      const recipient = await storage.getUser(recipientId);
      if (!recipient) return res.status(404).json({ message: "Recipient not found" });

      const sender = await storage.getUser(req.session.userId!);
      const message = await storage.createPrivateMessage({
        recipientId,
        senderId: req.session.userId!,
        subject,
        body,
      });

      broadcast({ type: "private_message", recipientId, messageId: message.id, subject: message.subject });

      const pmWantsPush = customerWantsPush(recipient, "private_message");
      const pmWantsEmail = !!(recipient.email && customerWantsEmail(recipient, "private_message") && sender);
      let pmNotifId: string | null = null;
      if (pmWantsPush || pmWantsEmail) {
        pmNotifId = await createBellNotification(recipientId, { type: "private_message", referenceType: "private_message", referenceId: message.id }, {
          title: "New Private Message",
          body: `${sender?.fullName}: ${subject}`,
          url: "/messages",
        });
      }
      if (pmWantsPush) {
        void sendPushToUser(recipientId, {
          title: "New Private Message",
          body: `${sender?.fullName}: ${subject}`,
          url: "/messages",
          tag: `pm-${message.id}`,
        }, pmNotifId ? { notificationId: pmNotifId } : { type: "private_message", referenceType: "private_message", referenceId: message.id });
      }

      if (recipient.email && customerWantsEmail(recipient, "private_message") && sender) {
        void sendTemplatedEmail(recipient.email, "customer_private_message", {
          sender_name: sender.fullName,
          message_subject: subject,
          message_body: body,
          customer_name: recipient.fullName,
        }, recipient.fullName);
      }

      res.json(message);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/private-messages/sent", requirePermission("messages.view", "messages.manage"), async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesBySender(req.session.userId!);
      res.json(messages);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/private-messages/:id", requirePermission("messages.view", "messages.manage"), async (req, res) => {
    try {
      const sentMessages = await storage.getPrivateMessagesBySender(req.session.userId!);
      const msg = sentMessages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      await storage.deletePrivateMessage(getParam(req, "id"));
      res.json({ message: "Message deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // === Message Threads (Conversational Messaging) ===

  app.post("/api/message-threads", requirePermission("messages.manage"), withUpload("image"), async (req, res) => {
    try {
      const customerId = typeof req.body.customerId === "string" ? req.body.customerId : "";
      const subject = typeof req.body.subject === "string" ? req.body.subject : "";
      const rawBody = typeof req.body.body === "string" ? req.body.body : "";
      const body = rawBody.trim();

      // KB attachment — the creator here is always an admin (route is gated by
      // messages.manage), so the admin gate always passes. Resolve KB +
      // validate required fields BEFORE persisting any upload so rejected
      // requests don't leave orphaned file blobs on disk.
      const rawKbSlug = typeof req.body.kbArticleSlug === "string" ? req.body.kbArticleSlug : "";
      const kbDecision = await resolveKbAttachmentForSender({ rawKbSlug, isAdminSending: true }, storage);
      if (!kbDecision.ok) {
        return res.status(kbDecision.status).json({ message: kbDecision.error });
      }
      const kbArticleSlug = kbDecision.kbArticleSlug;
      const kbArticleInfo = kbDecision.kbArticleInfo;

      if (!customerId || !subject) {
        return res.status(400).json({ message: "customerId and subject are required" });
      }
      // Body may be empty when an image and/or KB article is the sole payload.
      if (!body && !req.file && !kbArticleSlug) {
        return res.status(400).json({ message: "A message, image, or article is required" });
      }
      const customer = await storage.getUser(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      if (customer.role !== "customer") return res.status(400).json({ message: "Can only start conversations with customers" });

      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;

      const thread = await storage.createMessageThread({
        adminId: req.session.userId!,
        customerId,
        subject,
      });

      const msg = await storage.createThreadMessage({
        threadId: thread.id,
        senderId: req.session.userId!,
        body,
        imageUrl,
        kbArticleSlug,
      });
      const msgWithKb = { ...msg, kbArticle: kbArticleInfo };

      const sender = await storage.getUser(req.session.userId!);
      broadcastToThreadParticipants({ type: "thread_message", threadId: thread.id, message: { ...msgWithKb, senderName: sender?.fullName || "Admin" } }, [thread.adminId, thread.customerId]);

      const previewBody = body || (imageUrl ? "📷 Photo" : kbArticleSlug ? "📄 Article" : "");
      const threadWantsPush = customerWantsPush(customer, "thread_message");
      const threadWantsEmail = !!(customer.email && customerWantsEmail(customer, "thread_message") && sender);
      let threadNotifId: string | null = null;
      if (threadWantsPush || threadWantsEmail) {
        threadNotifId = await createBellNotification(customerId, { type: "message", referenceType: "message_thread", referenceId: thread.id }, {
          title: `Message from ${sender?.fullName || "Support"}`,
          body: `${subject}: ${previewBody.substring(0, 100)}`,
          url: `/messages/${thread.id}`,
        });
      }
      if (threadWantsPush) {
        void sendPushToUser(customerId, {
          title: `Message from ${sender?.fullName || "Support"}`,
          body: `${subject}: ${previewBody.substring(0, 100)}`,
          url: `/messages/${thread.id}`,
          tag: `thread-${thread.id}`,
          resourceLabel: `your conversation "${subject}"`,
          rollupNoun: "messages",
        }, threadNotifId ? { notificationId: threadNotifId } : { type: "message", referenceType: "message_thread", referenceId: thread.id });
      }

      if (customer.email && customerWantsEmail(customer, "thread_message") && sender) {
        void sendTemplatedEmail(customer.email, "customer_thread_message", {
          sender_name: sender.fullName,
          thread_subject: subject,
          message_body: previewBody,
          customer_name: customer.fullName,
        }, customer.fullName);
      }

      logActivity("messages", "thread_created", { actorId: req.session.userId!, targetId: thread.id, targetType: "message_thread", summary: `Started conversation "${subject}" with ${customer.fullName}` });

      res.json({ thread, message: msgWithKb });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/message-threads", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const threads = await storage.getMessageThreadsForUser(req.session.userId!, user.role);
      const enriched = await Promise.all(threads.map(async (t) => {
        const admin = await storage.getUser(t.adminId);
        const customer = await storage.getUser(t.customerId);
        const msgs = await storage.getThreadMessages(t.id);
        const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
        const unreadCount = msgs.filter(m => !m.readAt && m.senderId !== req.session.userId!).length;
        return {
          ...t,
          adminName: admin?.fullName || "Admin",
          customerName: customer?.fullName || "Customer",
          lastMessage: lastMsg ? { body: lastMsg.body, senderId: lastMsg.senderId, createdAt: lastMsg.createdAt } : null,
          unreadCount,
        };
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/message-threads/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadThreadMessageCount(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/message-threads/:id", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(getParam(req, "id"));
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const admin = await storage.getUser(thread.adminId);
      const customer = await storage.getUser(thread.customerId);
      res.json({ ...thread, adminName: admin?.fullName || "Admin", customerName: customer?.fullName || "Customer" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/message-threads/:id/messages", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(getParam(req, "id"));
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser2 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser2?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const messages = await storage.getThreadMessages(getParam(req, "id"));
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const senderMap = new Map<string, string>();
      await Promise.all(senderIds.map(async (id) => {
        const user = await storage.getUser(id);
        if (user) senderMap.set(id, user.fullName);
      }));
      const kbBySlug = await enrichKbArticlesForMessages(messages, storage);
      const enriched = messages.map(m => ({
        ...m,
        senderName: senderMap.get(m.senderId) || "Unknown",
        kbArticle: m.kbArticleSlug ? kbBySlug.get(m.kbArticleSlug) ?? null : null,
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/message-threads/:id/messages", requireAuth, withUpload("image"), async (req, res) => {
    try {
      const thread = await storage.getMessageThread(getParam(req, "id"));
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser3 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser3?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const isAdminSending = reqUser3?.role === "master_admin" || reqUser3?.role === "admin" || req.session.userId === thread.adminId;

      const rawBody = typeof req.body.body === "string" ? req.body.body : "";
      const body = rawBody.trim();

      // KB attachments are admin-only. Reject (don't silently drop) if a
      // non-admin tries to attach one, so the rule is enforced server-side.
      // Resolve KB + validate required fields BEFORE persisting any upload so
      // rejected requests don't leave orphaned file blobs on disk.
      const rawKbSlug = typeof req.body.kbArticleSlug === "string" ? req.body.kbArticleSlug : "";
      const kbDecision = await resolveKbAttachmentForSender({ rawKbSlug, isAdminSending }, storage);
      if (!kbDecision.ok) {
        return res.status(kbDecision.status).json({ message: kbDecision.error });
      }
      const kbArticleSlug = kbDecision.kbArticleSlug;
      const kbArticleInfo = kbDecision.kbArticleInfo;

      // Body may be empty when an image and/or KB article is the sole payload.
      if (!body && !req.file && !kbArticleSlug) {
        return res.status(400).json({ message: "A message, image, or article is required" });
      }

      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;

      const msg = await storage.createThreadMessage({
        threadId: thread.id,
        senderId: req.session.userId!,
        body,
        imageUrl,
        kbArticleSlug,
      });
      const msgWithKb = { ...msg, kbArticle: kbArticleInfo };

      await storage.updateMessageThread(thread.id, { lastMessageAt: new Date() });

      const sender = await storage.getUser(req.session.userId!);
      broadcastToThreadParticipants({ type: "thread_message", threadId: thread.id, message: { ...msgWithKb, senderName: sender?.fullName || "User" } }, [thread.adminId, thread.customerId]);

      const recipientId = isAdminSending ? thread.customerId : thread.adminId;
      const isRecipientViewing = isUserViewingThread(recipientId, thread.id);

      // If the recipient has any live connection, the WebSocket fan-out above
      // reached their client — mark the message delivered and tell the sender.
      if (presenceMap.hasUser(recipientId)) {
        await storage.markThreadMessagesDelivered(thread.id, recipientId);
        broadcastToThreadParticipants({ type: "thread_messages_delivered", threadId: thread.id, deliveredTo: recipientId }, [thread.adminId, thread.customerId]);
      }

      const shouldCreateNotif = !isRecipientViewing;
      const recipientUser = await storage.getUser(recipientId);
      const previewBody = body || (imageUrl ? "📷 Photo" : kbArticleSlug ? "📄 Article" : "");
      const replyWantsPush = customerWantsPush(recipientUser, "thread_message");
      const replyWantsEmail = !!(recipientUser?.email && customerWantsEmail(recipientUser, "thread_message") && sender);
      let threadReplyNotifId: string | null = null;
      if (shouldCreateNotif && (replyWantsPush || replyWantsEmail)) {
        threadReplyNotifId = await createBellNotification(recipientId, { type: "message", referenceType: "message_thread", referenceId: thread.id }, {
          title: `${sender?.fullName || "User"}`,
          body: previewBody.substring(0, 100),
          url: `/messages/${thread.id}`,
        });
      }
      if (replyWantsPush) {
        void sendPushToUser(recipientId, {
          title: `${sender?.fullName || "User"}`,
          body: previewBody.substring(0, 100),
          url: `/messages/${thread.id}`,
          tag: `thread-${thread.id}`,
          resourceLabel: `your conversation "${thread.subject}"`,
          rollupNoun: "messages",
        }, shouldCreateNotif ? (threadReplyNotifId ? { notificationId: threadReplyNotifId } : { type: "message", referenceType: "message_thread", referenceId: thread.id }) : undefined);
      }

      if (!isRecipientViewing) {
        const recipient = recipientUser;
        if (recipient?.email && customerWantsEmail(recipient, "thread_message") && sender) {
          const templateKey = isAdminSending ? "customer_thread_message" : "admin_thread_message";
          void sendTemplatedEmail(recipient.email, templateKey, {
            sender_name: sender.fullName,
            thread_subject: thread.subject,
            message_body: previewBody,
            customer_name: isAdminSending ? recipient.fullName : sender.fullName,
          }, recipient.fullName);
        }
      }

      res.json(msgWithKb);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/message-threads/:id/read", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(getParam(req, "id"));
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser4 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser4?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.markThreadMessagesRead(getParam(req, "id"), req.session.userId!);
      await db.update(userNotifications).set({ readAt: new Date() })
        .where(and(
          eq(userNotifications.userId, req.session.userId!),
          eq(userNotifications.type, "message"),
          eq(userNotifications.referenceId, getParam(req, "id")),
          isNull(userNotifications.readAt),
          isNull(userNotifications.dismissedAt)
        ));
      broadcastToThreadParticipants({ type: "thread_messages_read", threadId: req.params.id, readBy: req.session.userId! }, [thread.adminId, thread.customerId]);
      res.json({ message: "Marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/message-threads/:id", requirePermission("messages.manage"), async (req, res) => {
    try {
      const thread = await storage.getMessageThread(getParam(req, "id"));
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const delUser = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && delUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      // Capture attached image URLs BEFORE the rows are gone, then tidy up any
      // upload no longer referenced once the thread + its messages are deleted.
      const threadImageUrls = (await storage.getThreadMessages(getParam(req, "id")))
        .map((m) => m.imageUrl)
        .filter((u): u is string => !!u);
      await storage.deleteMessageThread(getParam(req, "id"));
      for (const url of threadImageUrls) {
        await deleteUploadedFileIfUnreferenced(url);
      }
      res.json({ message: "Thread deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/quick-responses", requirePermission("quick_responses.view", "quick_responses.manage"), async (req, res) => {
    try {
      const responses = await storage.getAllQuickResponses();
      res.json(responses);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const qrHandlers = createQuickResponseHandlers({ storage });
  app.post("/api/admin/quick-responses", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.create);
  app.patch("/api/admin/quick-responses/:id", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.update);
  app.delete("/api/admin/quick-responses/:id", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.remove);
  app.post("/api/quick-responses/:id/use", requireAdmin, qrHandlers.bumpUsage);

  app.get("/api/quick-responses", requireAuth, async (_req, res) => {
    try {
      const responses = await storage.getAllQuickResponses();
      res.json(responses);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/quick-response-categories", requireAuth, qrHandlers.listCategories);
  app.post("/api/admin/quick-response-categories", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.createCategory);
  app.patch("/api/admin/quick-response-categories/:id", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.updateCategory);
  app.delete("/api/admin/quick-response-categories/:id", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.removeCategory);
  app.post("/api/admin/quick-response-categories/reorder", requirePermission("quick_responses.view", "quick_responses.manage"), qrHandlers.reorderCategories);

  app.get("/api/quick-responses/favorites", requireAdmin, qrHandlers.listFavorites);
  app.post("/api/quick-responses/:id/favorite", requireAdmin, qrHandlers.addFavorite);
  app.delete("/api/quick-responses/:id/favorite", requireAdmin, qrHandlers.removeFavorite);

  app.get("/api/tickets/:id/suggestions", requireAdmin, async (req, res) => {
    try {
      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const [allQrs, msgs] = await Promise.all([
        storage.getAllQuickResponses(),
        // Suggestions feed customer-facing replies; exclude internal notes.
        storage.getTicketMessages(getParam(req, "id"), false),
      ]);
      const lastCustomer = [...msgs].reverse().find((m) => m.senderId === ticket.customerId);
      const top = suggestQuickResponses(ticket, lastCustomer?.message ?? null, allQrs, 3);
      res.json(top.map((qr) => ({ id: qr.id, title: qr.title, message: qr.message })));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/ai-draft/status", requireAdmin, async (_req, res) => {
    res.json({ enabled: isAiDraftEnabled() });
  });

  app.post("/api/tickets/:id/ai-draft", requireAdmin, async (req, res) => {
    try {
      if (!isAiDraftEnabled()) {
        return res.status(503).json({ message: "AI suggestions are not configured." });
      }
      const adminId = req.session.userId!;
      const limit = checkAiDraftRateLimit(adminId);
      if (!limit.allowed) {
        return res.status(429).json({
          message: "AI draft rate limit reached. Try again later.",
          resetAt: limit.resetAt,
        });
      }

      const ticket = await storage.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });

      const [allQrs, msgs, customer] = await Promise.all([
        storage.getAllQuickResponses(),
        // AI draft becomes a customer-facing reply; exclude internal notes from the prompt context.
        storage.getTicketMessages(getParam(req, "id"), false),
        storage.getUser(ticket.customerId),
      ]);

      const lastCustomer = [...msgs].reverse().find((m) => m.senderId === ticket.customerId);
      const hints = suggestQuickResponses(ticket, lastCustomer?.message ?? null, allQrs, 3);

      const recent = msgs.slice(-6);
      const senderCache = new Map<string, string>();
      const recentMessages = await Promise.all(recent.map(async (m) => {
        let name = senderCache.get(m.senderId);
        if (!name) {
          const u = await storage.getUser(m.senderId);
          name = u?.fullName || "User";
          senderCache.set(m.senderId, name);
        }
        const role: "customer" | "admin" = m.senderId === ticket.customerId ? "customer" : "admin";
        return { role, sender: name, message: m.message };
      }));

      const { system, user: userPrompt } = buildAiPrompt({
        ticket,
        customerName: customer?.fullName || "the customer",
        recentMessages,
        hints,
      });

      const client = getOpenAIClient();
      if (!client) return res.status(503).json({ message: "AI client unavailable." });

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 320,
      });

      const draft = completion.choices[0]?.message?.content?.trim() || "";
      if (!draft) return res.status(502).json({ message: "AI returned an empty response." });

      res.json({ draft, remaining: limit.remaining });
    } catch (e) {
      console.error("AI draft error:", e);
      res.status(500).json({ message: getErrorMessage(e) || "Failed to generate AI draft" });
    }
  });

  app.get("/api/report-requests", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role === "admin" || user.role === "master_admin") {
        const all = await storage.getAllReportRequests();
        const enriched = await Promise.all(all.map(async (rr) => {
          const customer = await storage.getUser(rr.customerId);
          const service = rr.serviceId ? await storage.getService(rr.serviceId) : null;
          return { ...rr, customerName: customer?.fullName || "Unknown", customerEmail: customer?.email || "", serviceName: service?.name || "N/A" };
        }));
        res.json(enriched);
      } else {
        const mine = await storage.getReportRequestsByCustomer(user.id);
        const enriched = await Promise.all(mine.map(async (rr) => {
          const service = rr.serviceId ? await storage.getService(rr.serviceId) : null;
          return { ...rr, serviceName: service?.name || "N/A" };
        }));
        res.json(enriched);
      }
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/report-requests", requireAuth, bypassRateLimitForAdmins, createReportLimiter(), withUpload("image"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const { type, serviceId, title, description } = req.body;
      if (!type || !title) return res.status(400).json({ message: "Type and title are required" });

      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;

      const rr = await storage.createReportRequest({
        customerId: user.id,
        type,
        serviceId: serviceId || null,
        title,
        description: description || null,
        imageUrl: imageUrl || null,
        status: "pending",
      });
      logActivity("report", "report_submitted", { actorId: user.id, targetId: rr.id, targetType: "report", summary: `Report submitted by ${user.fullName}: ${title} (${type})`, details: JSON.stringify({ customer: user.fullName, customerEmail: user.email, type, title, description }) });

      const service = serviceId ? await storage.getService(serviceId) : null;
      const typeLabels: Record<string, string> = {
        content_issue: "Content Issue Report",
        movie_request: "Movie/Series Request",
        app_issue: "App Issue / Feature Request",
      };
      const typeLabel = typeLabels[type] || type;

      if (user.email && customerWantsEmail(user, "report_received")) {
        void sendTemplatedEmail(user.email, "customer_report_received", {
          type_label: typeLabel,
          service_name: service?.name || "N/A",
          report_title: title,
          report_description_block: description ? `<blockquote>${escapeHtml(description).replace(/\n/g, "<br/>")}</blockquote>` : "",
          customer_name: user.fullName,
        }, user.fullName, new Set(["report_description_block"]));
      }

      const allUsers = await storage.getAllUsers();
      const admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
      for (const admin of admins) {
        const adminQuiet = shouldSuppressNotification({ user: admin, categoryKey: "admin_new_report" });
        if (!adminQuiet) {
          void sendPushToUser(admin.id, {
            title: `New ${typeLabel}`,
            body: `${user.fullName}: ${title}`,
            url: "/admin",
            tag: `report-request-${rr.id}`,
          }, { type: "new_report", referenceType: "report_request", referenceId: rr.id });
        }
        if (admin.email && !adminQuiet) {
          void sendTemplatedEmail(admin.email, "admin_new_report", {
            type_label: typeLabel,
            type_label_lower: typeLabel.toLowerCase(),
            customer_name: user.fullName,
            customer_username: user.username,
            customer_email: user.email,
            service_name: service?.name || "N/A",
            report_title: title,
            report_description_block: description ? `<blockquote>${escapeHtml(description).replace(/\n/g, "<br/>")}</blockquote>` : "",
          }, admin.fullName, new Set(["report_description_block"]));
        }
      }
      const adminIds = admins.map(a => a.id);
      storage.createContentNotificationBulk(adminIds, "admin-reports", `${typeLabel}: ${title}`, rr.id).catch(() => {});

      res.json(rr);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/report-requests/:id", requirePermission("reports.view", "reports.manage"), async (req, res) => {
    try {
      const { status, adminNotes } = req.body;
      const existing = await storage.getAllReportRequests().then(all => all.find(r => r.id === req.params.id));
      if (!existing) return res.status(404).json({ message: "Not found" });

      const updateData: any = {};
      if (status) updateData.status = status;
      if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

      const updated = await storage.updateReportRequest(getParam(req, "id"), updateData);
      if (!updated) return res.status(404).json({ message: "Not found" });
      if (status) {
        const reportCustomer = existing.customerId ? await storage.getUser(existing.customerId) : null;
        logActivity("report", "report_status_changed", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "report", summary: `Report "${existing.title}" by ${reportCustomer?.fullName || "Unknown"} status changed to ${status}`, details: JSON.stringify({ customer: reportCustomer?.fullName, customerEmail: reportCustomer?.email, title: existing.title, oldStatus: existing.status, newStatus: status, adminNotes }) });
      }

      if (status && status !== existing.status) {
        const typeLabelsMap: Record<string, string> = {
          content_issue: "Content Issue Report",
          movie_request: "Movie/Series Request",
          app_issue: "App Issue / Feature Request",
        };
        const typeLabel = typeLabelsMap[existing.type] || existing.type;
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

        const customer = await storage.getUser(existing.customerId);
        const reportWantsPush = customerWantsPush(customer, "report_update");
        const reportWantsEmail = !!(customer?.email && customerWantsEmail(customer, "report_update"));
        let reportNotifId: string | null = null;
        if (reportWantsPush || reportWantsEmail) {
          reportNotifId = await createBellNotification(existing.customerId, { type: "report_update", referenceType: "report_request", referenceId: existing.id }, {
            title: `${typeLabel} Updated`,
            body: `Your ${typeLabel.toLowerCase()} "${existing.title}" has been marked as ${statusLabel}`,
            url: "/report-request",
          });
        }
        if (reportWantsPush) {
          void sendPushToUser(existing.customerId, {
            title: `${typeLabel} Updated`,
            body: `Your ${typeLabel.toLowerCase()} "${existing.title}" has been marked as ${statusLabel}`,
            url: "/report-request",
            tag: `report-${existing.id}`,
          }, reportNotifId ? { notificationId: reportNotifId } : { type: "report_update", referenceType: "report_request", referenceId: existing.id });
        }

        if (customerWantsInApp(customer, "report_update")) {
          void storage.createReportNotification({
            userId: existing.customerId,
            reportRequestId: existing.id,
            message: `Your ${typeLabel.toLowerCase()} "${existing.title}" has been updated to ${statusLabel}`,
          });
        }

        if (customer?.email && customerWantsEmail(customer, "report_update")) {
          const notesRaw = adminNotes || updated.adminNotes || "";
          const notesBlock = notesRaw ? `<blockquote>${escapeHtml(notesRaw).replace(/\n/g, "<br/>")}</blockquote>` : "";
          void sendTemplatedEmail(customer.email, "customer_report_update", {
            type_label: typeLabel,
            report_title: existing.title,
            status_label: statusLabel,
            admin_notes_block: notesBlock,
            customer_name: customer.fullName,
          }, customer.fullName, new Set(["admin_notes_block"]));
        }
      }

      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/report-notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadReportNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/report-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await storage.markReportNotificationsRead(req.session.userId!);
      await storage.markUserNotificationsByTypeRead(req.session.userId!, ["report_update", "new_report"]);
      res.json({ message: "Marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/report-requests/:id", requirePermission("reports.view", "reports.manage"), async (req, res) => {
    try {
      const reportToDelete = await storage.getAllReportRequests().then(all => all.find(r => r.id === req.params.id));
      const delCustomer = reportToDelete?.customerId ? await storage.getUser(reportToDelete.customerId) : null;
      await storage.deleteReportRequest(getParam(req, "id"));
      logActivity("report", "report_deleted", { actorId: req.session.userId!, targetId: getParam(req, "id"), targetType: "report", summary: `Report deleted: "${reportToDelete?.title || getParam(req, "id")}" by ${delCustomer?.fullName || "Unknown"}`, details: JSON.stringify({ title: reportToDelete?.title, customer: delCustomer?.fullName }) });
      res.json({ message: "Deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/email-templates", requirePermission("email_templates.view", "email_templates.manage"), async (_req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/email-templates/:id", requirePermission("email_templates.view", "email_templates.manage"), async (req, res) => {
    try {
      const { subject, body, enabled } = req.body;
      const updateData: any = {};
      if (subject !== undefined) updateData.subject = subject;
      if (body !== undefined) updateData.body = body;
      if (enabled !== undefined) updateData.enabled = enabled;
      if (subject !== undefined || body !== undefined) updateData.customized = true;
      const updated = await storage.updateEmailTemplate(getParam(req, "id"), updateData);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/email-templates/:id/reset", requirePermission("email_templates.view", "email_templates.manage"), async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      const template = templates.find(t => t.id === req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const defaultTpl = getDefaultTemplate(template.templateKey);
      if (!defaultTpl) return res.status(404).json({ message: "Default template not found" });
      const updated = await storage.updateEmailTemplate(getParam(req, "id"), {
        subject: defaultTpl.subject,
        body: defaultTpl.body,
        customized: false,
      });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // WHMCS notification wording. GET merges the editable DB rows with the static
  // metadata (label/description/group/variables/default copy) from the shared
  // defs so the admin UI can render a self-describing editor. PATCH marks a row
  // customized; reset reverts to the built-in default. Both writes invalidate the
  // notifier's in-memory cache so edits take effect on the next pass.
  app.get("/api/admin/notification-templates", requirePermission("notification_templates.view", "notification_templates.manage"), async (_req, res) => {
    try {
      const rows = await storage.getAllNotificationTemplates();
      const byKey = new Map(rows.map((r) => [r.templateKey, r]));
      const merged = NOTIFICATION_TEMPLATE_DEFS.map((def) => {
        const row = byKey.get(def.key);
        return {
          id: row?.id ?? null,
          templateKey: def.key,
          group: def.group,
          label: def.label,
          description: def.description,
          variables: def.variables,
          defaultTitle: def.defaultTitle,
          defaultBody: def.defaultBody,
          title: row?.title ?? def.defaultTitle,
          body: row?.body ?? def.defaultBody,
          enabled: row?.enabled ?? true,
          customized: row?.customized ?? false,
        };
      });
      res.json(merged);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/notification-templates/:id", requirePermission("notification_templates.view", "notification_templates.manage"), async (req, res) => {
    try {
      const { title, body, enabled } = req.body;
      if (title !== undefined && typeof title !== "string") return res.status(400).json({ message: "title must be a string" });
      if (body !== undefined && typeof body !== "string") return res.status(400).json({ message: "body must be a string" });
      if (enabled !== undefined && typeof enabled !== "boolean") return res.status(400).json({ message: "enabled must be a boolean" });
      const updateData: Partial<{ title: string; body: string; enabled: boolean; customized: boolean }> = {};
      if (title !== undefined) updateData.title = title;
      if (body !== undefined) updateData.body = body;
      if (enabled !== undefined) updateData.enabled = enabled;
      if (title !== undefined || body !== undefined) updateData.customized = true;
      const updated = await storage.updateNotificationTemplate(getParam(req, "id"), updateData);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      invalidateNotificationTemplateCache();
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/notification-templates/:id/reset", requirePermission("notification_templates.view", "notification_templates.manage"), async (req, res) => {
    try {
      const rows = await storage.getAllNotificationTemplates();
      const template = rows.find((t) => t.id === req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const def = NOTIFICATION_TEMPLATE_DEFS.find((d) => d.key === template.templateKey);
      if (!def) return res.status(404).json({ message: "Default template not found" });
      const updated = await storage.updateNotificationTemplate(getParam(req, "id"), {
        title: def.defaultTitle,
        body: def.defaultBody,
        customized: false,
      });
      invalidateNotificationTemplateCache();
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/my-permissions", requireAdmin, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (user.role === "master_admin") {
        return res.json({ permissions: ["*"] });
      }
      if (!user.adminRoleId) {
        return res.json({ permissions: [] });
      }
      const role = await storage.getAdminRole(user.adminRoleId);
      return res.json({ permissions: role?.permissions || [] });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/roles", requireAdmin, async (_req, res) => {
    try {
      const roles = await storage.getAllAdminRoles();
      res.json(roles);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const adminRoleHandlers = createAdminRoleHandlers({ storage });
  app.post("/api/admin/roles", requireMasterAdmin, adminRoleHandlers.postAdmin);
  app.patch("/api/admin/roles/:id", requireMasterAdmin, adminRoleHandlers.patchAdmin);

  app.delete("/api/admin/roles/:id", requireMasterAdmin, adminRoleHandlers.deleteAdmin);

  app.get("/api/ticket-categories", requireAuth, async (_req, res) => {
    try {
      const categories = await storage.getAllTicketCategories();
      res.json(categories);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const ticketCategoryHandlers = createTicketCategoryHandlers({ storage });
  app.post("/api/admin/ticket-categories", requireMasterAdmin, ticketCategoryHandlers.postAdmin);
  app.patch("/api/admin/ticket-categories/:id", requireMasterAdmin, ticketCategoryHandlers.patchAdmin);

  app.delete("/api/admin/ticket-categories/:id", requireMasterAdmin, async (req, res) => {
    try {
      await storage.deleteTicketCategory(getParam(req, "id"));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/broadcast-push", requireMasterAdmin, async (req, res) => {
    try {
      const { title, message, userIds } = req.body;
      if (!title || !message || !userIds?.length) {
        return res.status(400).json({ message: "title, message, and userIds are required" });
      }
      const broadcastMsg = await storage.createBroadcastMessage(
        { title, message, senderId: req.session.userId! },
        userIds
      );
      broadcast({ type: "broadcast_alert", broadcastId: broadcastMsg.id, title, message, recipientIds: userIds });
      let sent = 0;
      for (const userId of userIds) {
        const recipient = await storage.getUser(userId);
        const isAdminRecipient = recipient?.role === "admin" || recipient?.role === "master_admin";
        if (isAdminRecipient && !adminWantsPush(recipient, "admin_broadcast")) continue;
        const url = isAdminRecipient ? "/admin?tab=admin-management&section=broadcast" : "/";
        const subs = await storage.getPushSubscriptionsByUser(userId);
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: "Urgent Admin Alert", body: message, url })
            );
            sent++;
          } catch (err) {
            if (getErrorStatusCode(err) === 410) {
              await storage.deletePushSubscription(sub.endpoint);
            }
          }
        }
      }
      res.json({ success: true, sent });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/broadcasts/unread", requireAuth, async (req, res) => {
    try {
      const broadcasts = await storage.getUnreadBroadcasts(req.session.userId!);
      res.json(broadcasts);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/broadcasts/:id/acknowledge", requireAuth, async (req, res) => {
    try {
      await storage.markBroadcastRead(getParam(req, "id"), req.session.userId!);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/users/:id/role", requireMasterAdmin, async (req, res) => {
    try {
      const targetUser = await storage.getUser(getParam(req, "id"));
      if (!targetUser) return res.status(404).json({ message: "User not found" });
      const protectedUsernames = ["cowboy"];
      if (protectedUsernames.includes(targetUser.username.toLowerCase())) {
        const { role } = req.body;
        if (role !== undefined && role !== "master_admin") {
          return res.status(403).json({ message: "This account's role cannot be changed" });
        }
      }
      const { role, adminRoleId } = req.body;
      const updateData: any = {};
      if (role !== undefined) updateData.role = role;
      if (adminRoleId !== undefined) updateData.adminRoleId = adminRoleId;
      const updated = await storage.updateUser(getParam(req, "id"), updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      if (role !== undefined) {
        logActivity("user", "user_role_changed", { actorId: req.session.userId!, targetId: targetUser.id, targetType: "user", summary: `${targetUser.fullName} role changed to ${role}`, details: JSON.stringify({ username: targetUser.username, oldRole: targetUser.role, newRole: role, adminRoleId }) });
      }
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/chat/users", requirePermission("admin_chat"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const adminUsers = allUsers
        .filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support" && u.id !== req.session.userId)
        .map(u => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role }));
      res.json(adminUsers);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/chat/unread-count", requirePermission("admin_chat"), async (req, res) => {
    try {
      const count = await storage.getAdminChatUnreadCounts(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/chat/unread-threads", requirePermission("admin_chat"), async (req, res) => {
    try {
      const threadIds = await storage.getAdminChatUnreadThreadIds(req.session.userId!);
      res.json(threadIds);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/chat/threads/:id/read", requirePermission("admin_chat"), async (req, res) => {
    try {
      await storage.markAdminChatThreadRead(getParam(req, "id"), req.session.userId!);
      res.json({ message: "Marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/chat/threads", requirePermission("admin_chat"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      let threads;
      if (user.role === "master_admin") {
        const { db: dbInst } = await import("./db");
        const { adminChatThreads: threadsTable } = await import("@shared/schema");
        const { desc } = await import("drizzle-orm");
        threads = await dbInst.select().from(threadsTable).orderBy(desc(threadsTable.createdAt));
      } else {
        threads = await storage.getAdminChatThreadsForUser(req.session.userId!);
      }
      const enriched = await Promise.all(threads.map(async (thread) => {
        const participants = await storage.getAdminChatParticipants(thread.id);
        const participantUsers = await Promise.all(
          participants.map(async (p) => {
            const u = await storage.getUser(p.userId);
            return u ? { id: u.id, fullName: u.fullName, username: u.username } : null;
          })
        );
        const messages = await storage.getAdminChatMessages(thread.id);
        const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
        return {
          ...thread,
          participants: participantUsers.filter(Boolean),
          lastMessage,
        };
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/chat/threads", requirePermission("admin_chat"), async (req, res) => {
    try {
      const { name, participantIds } = req.body;
      if (!participantIds?.length) {
        return res.status(400).json({ message: "participantIds required" });
      }
      const thread = await storage.createAdminChatThread({ name: name || null, createdBy: req.session.userId! });
      await storage.addAdminChatParticipant({ threadId: thread.id, userId: req.session.userId! });
      for (const pId of participantIds) {
        if (pId !== req.session.userId) {
          await storage.addAdminChatParticipant({ threadId: thread.id, userId: pId });
        }
      }
      res.json(thread);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/chat/threads/:id/messages", requirePermission("admin_chat"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "master_admin") {
        const participants = await storage.getAdminChatParticipants(getParam(req, "id"));
        if (!participants.some(p => p.userId === user.id)) {
          return res.status(403).json({ message: "Not a participant" });
        }
      }
      const messages = await storage.getAdminChatMessages(getParam(req, "id"));
      const enriched = await Promise.all(messages.map(async (msg) => {
        const sender = await storage.getUser(msg.senderId);
        return { ...msg, senderName: sender?.fullName || "Unknown" };
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/chat/threads/:id/messages", requirePermission("admin_chat"), withUpload("file"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "master_admin") {
        const participants = await storage.getAdminChatParticipants(getParam(req, "id"));
        if (!participants.some(p => p.userId === user.id)) {
          return res.status(403).json({ message: "Not a participant" });
        }
      }
      let fileUrl = null;
      let fileType = null;
      if (req.file) {
        fileUrl = await saveUploadedFile(req.file);
        fileType = req.file.mimetype;
      }
      const msg = await storage.createAdminChatMessage({
        threadId: getParam(req, "id"),
        senderId: req.session.userId!,
        message: req.body.message || "",
        fileUrl,
        fileType,
      });
      const participants = await storage.getAdminChatParticipants(getParam(req, "id"));
      broadcast({
        type: "admin_chat_message",
        threadId: req.params.id,
        message: { ...msg, senderName: user.fullName },
        participantIds: participants.map(p => p.userId),
      });

      const thread = await storage.getAdminChatThread(getParam(req, "id"));
      const otherParticipants = participants.filter(p => p.userId !== req.session.userId!);
      let threadLabel = thread?.name || "";
      if (!threadLabel) {
        const participantUsers = await Promise.all(
          participants.map(p => storage.getUser(p.userId))
        );
        const otherNames = participantUsers
          .filter(u => u && u.id !== req.session.userId!)
          .map(u => u!.fullName);
        threadLabel = otherNames.join(", ") || "Admin Chat";
      }
      const messagePreview = (req.body.message || "").substring(0, 100) || (req.file ? "Sent an attachment" : "New message");
      for (const p of otherParticipants) {
        if (!isUserViewingAdminChat(p.userId, getParam(req, "id"))) {
          const recipient = await storage.getUser(p.userId);
          if (adminWantsPush(recipient, "admin_chat_message")) {
            void sendPushToUser(p.userId, {
              title: `Admin Chat - ${threadLabel}`,
              body: `${user.fullName}: ${messagePreview}`,
              url: `/admin?tab=admin-chat&chat=${req.params.id}`,
              tag: `admin-chat-${req.params.id}`,
              resourceLabel: `Admin Chat — ${threadLabel}`,
              rollupNoun: "messages",
            }, { type: "admin_chat_message", referenceType: "admin_chat_thread", referenceId: getParam(req, "id") });
          }
        }
      }

      res.json({ ...msg, senderName: user.fullName });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/chat/threads/:id", requireMasterAdmin, async (req, res) => {
    try {
      await storage.deleteAdminChatThread(getParam(req, "id"));
      res.json({ message: "Thread deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/private-messages", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesByUser(req.session.userId!);
      const senderIds = [...new Set(messages.map(m => m.senderId))];
      const senderMap = new Map<string, string>();
      await Promise.all(senderIds.map(async (id) => {
        const user = await storage.getUser(id);
        if (user) senderMap.set(id, user.fullName);
      }));
      const enriched = messages.map(m => ({
        ...m,
        senderName: senderMap.get(m.senderId) || "Unknown",
      }));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/private-messages/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadPrivateMessageCount(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/private-messages/:id", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesByUser(req.session.userId!);
      const msg = messages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      await storage.deletePrivateMessage(getParam(req, "id"));
      res.json({ message: "Message deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/private-messages/:id/read", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesByUser(req.session.userId!);
      const msg = messages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      const updated = await storage.markPrivateMessageRead(getParam(req, "id"));
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Ticket notification routes
  app.get("/api/ticket-notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadTicketNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/ticket-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await storage.markTicketNotificationsRead(req.session.userId!);
      await storage.markUserNotificationsByTypeRead(req.session.userId!, ["ticket_update", "new_ticket"]);
      res.json({ message: "Notifications marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/content-notifications/counts", requireAuth, async (req, res) => {
    try {
      const counts = await storage.getUnreadContentNotificationCounts(req.session.userId!);
      res.json(counts);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/content-notifications/unread-references/:category", requireAuth, async (req, res) => {
    try {
      const referenceIds = await storage.getUnreadContentNotificationReferenceIds(req.session.userId!, getParam(req, "category"));
      res.json(referenceIds);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/content-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      const { category } = req.body;
      if (!category) return res.status(400).json({ message: "Category is required" });
      await storage.markContentNotificationsRead(req.session.userId!, category);
      const categoryToNotifTypes: Record<string, string[]> = {
        "alerts": ["alert"],
        "news": ["news"],
        "service-updates": ["service_update"],
        "services": ["service_status"],
        "admin-users": ["new_signup"],
      };
      const notifTypes = categoryToNotifTypes[category];
      if (notifTypes) {
        await storage.markUserNotificationsByTypeRead(req.session.userId!, notifTypes);
      }
      res.json({ message: "Marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Push notification subscription routes
  app.post("/api/push/subscribe", requireAuth, async (req, res) => {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ message: "Invalid subscription" });
      }
      const sub = await storage.createPushSubscription({
        userId: req.session.userId!,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      });
      res.json(sub);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (endpoint) {
        await storage.deletePushSubscription(endpoint);
      }
      res.json({ message: "Unsubscribed" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/push/vapid-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  });

  const dashboardHandler = createDashboardHandler({
    storage,
    getOnlineUsersCount: () => new Set(wsSessionUserMap.values()).size,
  });
  app.get("/api/admin/dashboard", requirePermission("dashboard.view"), dashboardHandler);

  async function buildOnlineUsersResponse() {
    const snap = presenceMap.snapshot();
    const userIds = snap.map(s => s.userId);
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    return snap.map((s, i) => {
      const u = users[i];
      return {
        userId: s.userId,
        fullName: u?.fullName || "Unknown",
        username: u?.username || "",
        role: u?.role || "unknown",
        tabs: s.tabs,
        connectedAt: new Date(s.connectedAt).toISOString(),
        lastActivityAt: new Date(s.lastActivityAt).toISOString(),
        idleSeconds: Math.max(0, Math.floor((Date.now() - s.lastActivityAt) / 1000)),
        page: s.page,
      };
    });
  }

  app.get("/api/admin/online-users", requireAdmin, async (_req, res) => {
    try {
      res.json(await buildOnlineUsersResponse());
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  function broadcastPresenceToAdmins(payload: any) {
    const message = JSON.stringify(payload);
    wsClients.forEach((client) => {
      if (client.readyState !== WebSocket.OPEN) return;
      const uid = wsSessionUserMap?.get(client);
      if (!uid) return;
      storage.getUser(uid).then((u) => {
        if (!u) return;
        if (u.role === "admin" || u.role === "master_admin") {
          if (client.readyState === WebSocket.OPEN) client.send(message);
        }
      }).catch(() => {});
    });
  }

  // WebSocket
  app.get("/api/admin/activity-logs", requirePermission("logs.view"), async (req, res) => {
    try {
      const { category, action, search, page, limit } = req.query;
      const result = await storage.getActivityLogs({
        category: queryString(category),
        action: queryString(action),
        search: queryString(search),
        page: queryInt(page, 1),
        limit: queryInt(limit, 50),
      });
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u.fullName]));
      const enrichedLogs = result.logs.map(log => ({
        ...log,
        actorName: log.actorId ? userMap.get(log.actorId) || null : null,
        recipientName: log.recipientId ? userMap.get(log.recipientId) || null : null,
      }));
      res.json({ logs: enrichedLogs, total: result.total });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/error-logs", requirePermission("error_log.view"), async (req, res) => {
    try {
      const { severity, source, search, resolved, page, limit } = req.query;
      const resolvedParsed = resolved === "true" ? true : resolved === "false" ? false : undefined;
      const result = await storage.getErrorLogs({
        severity: queryString(severity),
        source: queryString(source),
        search: queryString(search),
        resolved: resolvedParsed,
        page: queryInt(page, 1),
        limit: queryInt(limit, 50),
      });
      const userIds = new Set<string>();
      result.logs.forEach(l => { if (l.userId) userIds.add(l.userId); if (l.resolvedBy) userIds.add(l.resolvedBy); });
      const userMap = new Map<string, string>();
      if (userIds.size > 0) {
        const allUsers = await storage.getAllUsers();
        allUsers.forEach(u => { if (userIds.has(u.id)) userMap.set(u.id, u.fullName); });
      }
      const enriched = result.logs.map(l => ({
        ...l,
        userName: l.userId ? userMap.get(l.userId) || null : null,
        resolvedByName: l.resolvedBy ? userMap.get(l.resolvedBy) || null : null,
      }));
      res.json({ logs: enriched, total: result.total });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/error-logs/unresolved-count", requirePermission("error_log.view"), async (_req, res) => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const count = await storage.countUnresolvedErrorLogsSince(since);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // App-level settings (singleton). Currently exposes the auto-deploy
  // kill-switch — read by the VPS webhook listener over HTTP before invoking
  // update.sh, written from the admin UI to pause deploys during a
  // maintenance window.
  //
  // Read-side accepts EITHER a master_admin session OR a bearer token that
  // matches DEPLOY_GATE_TOKEN — the deploy webhook listener has no session
  // context and needs to read this flag pre-deploy. Write-side stays
  // session-only (operator action, must be attributable to a user).
  app.get("/api/admin/app-settings", async (req, res) => {
    try {
      const gateToken = process.env.DEPLOY_GATE_TOKEN;
      const auth = req.headers.authorization || "";
      const bearerOk = !!gateToken && auth.startsWith("Bearer ") && auth.slice(7) === gateToken;
      if (!bearerOk) {
        // Fall through to session-based master_admin check.
        const userId = (req as any).session?.userId;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });
        const u = await storage.getUser(userId);
        if (!u || u.role !== "master_admin") return res.status(403).json({ message: "Forbidden" });
      }
      const settings = await storage.getAppSettings();
      res.json(settings);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Proxy to the VPS deploy listener's GET /notify-status endpoint. The
  // listener lives on 127.0.0.1:5055 (nginx proxies /_deploy/* to it on
  // prod), so the browser can't hit it directly; even if it could, the
  // endpoint is gated on DEPLOY_GATE_TOKEN which is a server-side secret
  // we don't want shipped to the client. This route attaches the bearer
  // token server-side and returns the listener's last-known Discord
  // notification health for the Admin Portal Deploy page.
  app.get("/api/admin/deploy/notify-status", requireMasterAdmin, async (_req, res) => {
    try {
      const gateToken = process.env.DEPLOY_GATE_TOKEN;
      if (!gateToken) {
        return res.json({
          available: false,
          reason: "DEPLOY_GATE_TOKEN not configured on the app server",
        });
      }
      const listenerUrl = process.env.DEPLOY_LISTENER_URL || "http://127.0.0.1:5055";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      try {
        const upstream = await fetch(`${listenerUrl}/notify-status`, {
          headers: { Authorization: `Bearer ${gateToken}` },
          signal: ctl.signal,
        });
        if (!upstream.ok) {
          return res.json({
            available: false,
            reason: `listener returned HTTP ${upstream.status}`,
          });
        }
        const status = await upstream.json();
        return res.json({ available: true, ...status });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return res.json({
        available: false,
        reason: `listener unreachable: ${getErrorMessage(e) || "error"}`,
      });
    }
  });

  // Proxy to the VPS deploy listener's GET /deploy-history endpoint.
  // Same shape/rationale as the notify-status proxy above — DEPLOY_GATE_TOKEN
  // stays server-side, browser hits this app route, and we shape the response
  // into { available, deploys } so the Admin Portal can render an offline
  // banner in the Replit dev environment without a thrown error.
  app.get("/api/admin/deploy/history", requireMasterAdmin, async (_req, res) => {
    try {
      const gateToken = process.env.DEPLOY_GATE_TOKEN;
      if (!gateToken) {
        return res.json({
          available: false,
          reason: "DEPLOY_GATE_TOKEN not configured on the app server",
          deploys: [],
        });
      }
      const listenerUrl = process.env.DEPLOY_LISTENER_URL || "http://127.0.0.1:5055";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3000);
      try {
        const upstream = await fetch(`${listenerUrl}/deploy-history`, {
          headers: { Authorization: `Bearer ${gateToken}` },
          signal: ctl.signal,
        });
        if (!upstream.ok) {
          return res.json({
            available: false,
            reason: `listener returned HTTP ${upstream.status}`,
            deploys: [],
          });
        }
        const body = await upstream.json();
        return res.json({ available: true, deploys: body.deploys || [] });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return res.json({
        available: false,
        reason: `listener unreachable: ${getErrorMessage(e) || "error"}`,
        deploys: [],
      });
    }
  });

  // Proxy to the VPS deploy listener's POST /notify-test endpoint. Lets a
  // master_admin fire a benign Discord post end-to-end to verify a freshly
  // rotated DEPLOY_DISCORD_WEBHOOK without having to push a real commit.
  // Same fail-soft semantics as the GET /notify-status proxy: if the gate
  // token isn't configured or the listener is unreachable, return a JSON
  // body describing why instead of a 5xx — the dev environment legitimately
  // has no listener, and we want the toast to explain that.
  app.post("/api/admin/deploy/notify-test", requireMasterAdmin, async (_req, res) => {
    try {
      const gateToken = process.env.DEPLOY_GATE_TOKEN;
      if (!gateToken) {
        return res.json({
          available: false,
          reason: "DEPLOY_GATE_TOKEN not configured on the app server",
        });
      }
      const listenerUrl = process.env.DEPLOY_LISTENER_URL || "http://127.0.0.1:5055";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      try {
        const upstream = await fetch(`${listenerUrl}/notify-test`, {
          method: "POST",
          headers: { Authorization: `Bearer ${gateToken}` },
          signal: ctl.signal,
        });
        if (!upstream.ok) {
          return res.json({
            available: false,
            reason: `listener returned HTTP ${upstream.status}`,
          });
        }
        const status = await upstream.json();
        return res.json({ available: true, ...status });
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return res.json({
        available: false,
        reason: `listener unreachable: ${getErrorMessage(e) || "error"}`,
      });
    }
  });

  // Proxy to the VPS deploy listener's GET /log/<id> endpoint. Returns the
  // raw plain-text per-deploy log so the Admin Portal can show the tail
  // inside an expandable row. Delivery IDs are restricted to the same safe
  // charset the listener uses, defense-in-depth against any path traversal
  // attempt before the request even leaves this process.
  app.get("/api/admin/deploy/log/:deliveryId", requireMasterAdmin, async (req, res) => {
    try {
      const safeId = String(req.params.deliveryId || "").replace(/[^a-zA-Z0-9_-]/g, "");
      if (!safeId) return res.status(400).type("text/plain").send("bad delivery id");
      const gateToken = process.env.DEPLOY_GATE_TOKEN;
      if (!gateToken) {
        return res.status(503).type("text/plain").send("DEPLOY_GATE_TOKEN not configured on the app server");
      }
      const listenerUrl = process.env.DEPLOY_LISTENER_URL || "http://127.0.0.1:5055";
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 5000);
      try {
        const upstream = await fetch(`${listenerUrl}/log/${safeId}`, {
          headers: { Authorization: `Bearer ${gateToken}` },
          signal: ctl.signal,
        });
        if (!upstream.ok) {
          return res.status(upstream.status).type("text/plain").send(`listener returned HTTP ${upstream.status}`);
        }
        const text = await upstream.text();
        return res.type("text/plain").send(text);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      return res.status(502).type("text/plain").send(`listener unreachable: ${getErrorMessage(e) || "error"}`);
    }
  });

  app.patch("/api/admin/app-settings", requireMasterAdmin, async (req, res) => {
    try {
      const userId = (req as any).session?.userId || null;
      const body = req.body || {};
      const patch: { autoDeployEnabled?: boolean; autoDeployPausedReason?: string | null; autoDeployPausedBy?: string | null } = {};
      if (typeof body.autoDeployEnabled === "boolean") {
        patch.autoDeployEnabled = body.autoDeployEnabled;
        patch.autoDeployPausedReason = body.autoDeployEnabled ? null : (body.autoDeployPausedReason ?? null);
        patch.autoDeployPausedBy = body.autoDeployEnabled ? null : userId;
      }
      const updated = await storage.updateAppSettings(patch);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // System-health snapshot for the admin dashboard tile. Master-admin only —
  // exposes raw error summaries and latency numbers that aren't safe for
  // delegated admins. Designed to be cheap so the tile can poll on a 30s
  // interval without straining the DB.
  app.get("/api/admin/health/errors", requireMasterAdmin, async (_req, res) => {
    try {
      // 1) DB latency: single SELECT 1 round-trip in ms.
      const t0 = Date.now();
      let dbOk = true;
      try {
        await db.execute(sql`SELECT 1`);
      } catch {
        dbOk = false;
      }
      const dbLatencyMs = Date.now() - t0;

      // 2) Last 20 error fingerprints — newest first, regardless of severity.
      const recent = await storage.getErrorLogs({ limit: 20, page: 1 });

      // 3) 5xx count over last 5 minutes. Pull the most recent 100 route
      //    errors and bucket in JS — avoids a custom SQL helper for what is
      //    almost always single-digit volume.
      const fiveMinAgo = Date.now() - 5 * 60 * 1000;
      const routeErrors = await storage.getErrorLogs({ source: "route", limit: 100, page: 1 });
      const count5xxLast5Min = routeErrors.logs.filter(
        (l) => new Date(l.createdAt).getTime() >= fiveMinAgo,
      ).length;

      res.json({
        dbOk,
        dbLatencyMs,
        count5xxLast5Min,
        recent: recent.logs.map((l) => ({
          id: l.id,
          severity: l.severity,
          source: l.source,
          summary: l.summary,
          createdAt: l.createdAt,
          resolvedAt: l.resolvedAt,
        })),
      });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/error-logs/:id", requirePermission("error_log.view"), async (req, res) => {
    try {
      const log = await storage.getErrorLog(getParam(req, "id"));
      if (!log) return res.status(404).json({ message: "Error log not found" });
      res.json(log);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/error-logs/:id/resolve", requirePermission("error_log.view"), async (req, res) => {
    try {
      const resolved = req.body?.resolved !== false;
      const userId = (req as any).session?.userId || null;
      const log = await storage.setErrorLogResolved(getParam(req, "id"), resolved, resolved ? userId : null);
      if (!log) return res.status(404).json({ message: "Error log not found" });
      res.json(log);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/activity-logs/:id", requirePermission("logs.view"), async (req, res) => {
    try {
      const log = await storage.getActivityLog(getParam(req, "id"));
      if (!log) return res.status(404).json({ message: "Log entry not found" });
      if (log.actorId) {
        const actor = await storage.getUser(log.actorId);
        (log as any).actorName = actor?.fullName || null;
      }
      if (log.recipientId) {
        const recipient = await storage.getUser(log.recipientId);
        (log as any).recipientName = recipient?.fullName || null;
      }
      res.json(log);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/downloads", requireAuth, async (_req, res) => {
    try {
      const result = await storage.getAllDownloads();
      res.json(result);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/downloads", requirePermission("downloads.view", "downloads.manage"), withUpload("image"), async (req, res) => {
    try {
      const parsed = insertDownloadSchema.omit({ imageUrl: true }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors.map(e => getErrorMessage(e)).join(", ") });
      }
      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;
      const dl = await storage.createDownload({ ...parsed.data, imageUrl });
      res.json(dl);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/downloads/:id", requirePermission("downloads.view", "downloads.manage"), withUpload("image"), async (req, res) => {
    try {
      const { title, description, downloaderCode, downloadUrl, removeImage } = req.body;
      const updateData: Partial<{ title: string; description: string; downloaderCode: string; downloadUrl: string; imageUrl: string | null }> = {};
      if (title !== undefined) updateData.title = title;
      if (description !== undefined) updateData.description = description;
      if (downloaderCode !== undefined) updateData.downloaderCode = downloaderCode;
      if (downloadUrl !== undefined) updateData.downloadUrl = downloadUrl;
      if (req.file) {
        updateData.imageUrl = await saveUploadedFile(req.file);
      } else if (removeImage === "true") {
        updateData.imageUrl = null;
      }
      const dl = await storage.updateDownload(getParam(req, "id"), updateData);
      if (!dl) return res.status(404).json({ message: "Download not found" });
      res.json(dl);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/downloads/:id", requirePermission("downloads.view", "downloads.manage"), async (req, res) => {
    try {
      const existing = await storage.getDownload(getParam(req, "id"));
      if (!existing) return res.status(404).json({ message: "Download not found" });
      await storage.deleteDownload(getParam(req, "id"));
      res.json({ message: "Deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  storage.deleteExpiredUserNotifications(30).then(count => {
    if (count > 0) console.log(`[Cleanup] Deleted ${count} expired notification(s) older than 30 days`);
  }).catch(e => console.error("[Cleanup] Failed to delete expired notifications:", getErrorMessage(e)));

  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(queryInt(req.query.limit, 50), 100);
      const offset = queryInt(req.query.offset, 0);
      const notifications = await storage.getUserNotifications(req.session.userId!, limit, offset);
      res.json(notifications);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadUserNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  async function clearRelatedBadge(userId: string, notif: { type: string; referenceType: string | null; referenceId: string | null }) {
    try {
      if (notif.type === "ticket_update" || notif.type === "new_ticket") {
        await storage.markTicketNotificationsRead(userId);
      } else if (notif.type === "message" && notif.referenceId) {
        await storage.markThreadMessagesRead(notif.referenceId, userId);
      } else if (notif.type === "report_update" || notif.type === "new_report") {
        await storage.markReportNotificationsRead(userId);
      } else if (notif.type === "alert" || notif.type === "news" || notif.type === "service_update" || notif.type === "new_signup") {
        const categoryMap: Record<string, string> = { alert: "alerts", news: "news", service_update: "service-updates", new_signup: "admin-users" };
        const cat = categoryMap[notif.type];
        if (cat) await storage.markContentNotificationsRead(userId, cat);
      } else if (notif.type === "service_status") {
        await storage.markContentNotificationsRead(userId, "services");
      }
    } catch (e) {
      console.error("[NotifBadge] Failed to clear related badge:", getErrorMessage(e));
    }
  }

  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const notif = await storage.getUserNotification(getParam(req, "id"), req.session.userId!);
      if (!notif) return res.status(404).json({ message: "Notification not found" });
      // Coalesced rollup support: when the user taps "Mark as read" on a
      // single OS toast, also flip every other unread row that points at
      // the same resource (referenceType + referenceId). Pairs with the
      // service-worker rollup logic so the entire group disappears at
      // once. clearRelatedBadge below still handles per-area badges.
      const groupCleared = await markGroupRead(storage, req.session.userId!, notif);
      await clearRelatedBadge(req.session.userId!, notif);
      res.json({ message: "Marked as read", groupCleared });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/notifications/:id/dismiss", requireAuth, async (req, res) => {
    try {
      const notif = await storage.getUserNotification(getParam(req, "id"), req.session.userId!);
      if (!notif) return res.status(404).json({ message: "Notification not found" });
      await storage.dismissUserNotification(getParam(req, "id"), req.session.userId!);
      await clearRelatedBadge(req.session.userId!, notif);
      res.json({ message: "Dismissed" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/notifications/cleanup", requireMasterAdmin, async (req, res) => {
    try {
      const count = await storage.deleteExpiredUserNotifications(30);
      res.json({ deleted: count });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      await storage.dismissAllUserNotifications(userId);
      await storage.markTicketNotificationsRead(userId);
      await storage.markReportNotificationsRead(userId);
      await storage.markContentNotificationsRead(userId, "alerts");
      await storage.markContentNotificationsRead(userId, "news");
      await storage.markContentNotificationsRead(userId, "service-updates");
      await storage.markContentNotificationsRead(userId, "services");
      await storage.markContentNotificationsRead(userId, "admin-users");
      await storage.markContentNotificationsRead(userId, "admin-reports");
      res.json({ message: "All marked as read" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  wssRef = wss;
  wsSessionUserMap = new Map<WebSocket, string>();

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") { socket.destroy(); return; }
    const fakeRes = Object.create(ServerResponse.prototype);
    sessionMiddleware(req as unknown as Request, fakeRes as unknown as Response, () => {
      const sessionReq = req as unknown as Request;
      const userId = sessionReq.session?.userId;
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (userId) {
          wsSessionUserMap.set(ws, userId);
          storage.getUser(userId).then((u) => {
            if (u && wsClients.has(ws)) wsSessionRoleMap.set(ws, u.role);
          }).catch(() => {});
        }
        wss.emit("connection", ws, req);
      });
    });
  });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    const sessionUserId = wsSessionUserMap.get(ws);
    if (sessionUserId) {
      const wasOnline = presenceMap.hasUser(sessionUserId);
      presenceMap.add(ws, sessionUserId);
      if (!wasOnline) {
        broadcastPresenceToAdmins({ type: "presence_changed", userId: sessionUserId, status: "online" });
      } else {
        broadcastPresenceToAdmins({ type: "presence_changed", userId: sessionUserId, status: "tab_added" });
      }
      // The user just (re)connected — any messages sent to them while they were
      // offline have now reached a live client. Flip those to "Delivered" and
      // notify the senders so their "Sent" receipts advance live.
      storage.markUndeliveredThreadMessagesForUser(sessionUserId).then((threads) => {
        for (const t of threads) {
          broadcastToThreadParticipants({ type: "thread_messages_delivered", threadId: t.id, deliveredTo: sessionUserId }, [t.adminId, t.customerId]);
        }
      }).catch(() => {});
    }

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === "current_page" && typeof data.page === "string") {
          presenceMap.setPage(ws, data.page.slice(0, 200));
          if (sessionUserId) {
            broadcastPresenceToAdmins({ type: "presence_changed", userId: sessionUserId, status: "page", page: data.page.slice(0, 200) });
          }
        }
        if (data.type === "typing" && data.ticketId && data.userId && data.userName) {
          broadcastExcept({ type: "typing", ticketId: data.ticketId, userId: data.userId, userName: data.userName }, ws);
        }
        if (data.type === "admin_chat_typing" && data.threadId && data.userId && data.userName) {
          broadcastExcept({ type: "admin_chat_typing", threadId: data.threadId, userId: data.userId, userName: data.userName }, ws);
        }
        if (data.type === "viewing_admin_chat" && data.threadId && data.userId) {
          const prev = wsAdminChatMap.get(ws);
          if (prev) {
            removeAdminChatViewer(prev.threadId, prev.userId);
          }
          wsAdminChatMap.set(ws, { userId: data.userId, threadId: data.threadId });
          addAdminChatViewer(data.threadId, data.userId);
        }
        if (data.type === "left_admin_chat" && data.threadId && data.userId) {
          removeAdminChatViewer(data.threadId, data.userId);
          const info = wsAdminChatMap.get(ws);
          if (info && info.threadId === data.threadId) wsAdminChatMap.delete(ws);
        }
        if (data.type === "thread_typing" && data.threadId && sessionUserId && data.userName) {
          storage.getMessageThread(data.threadId).then((thread) => {
            if (!thread) return;
            if (thread.adminId !== sessionUserId && thread.customerId !== sessionUserId) return;
            const msg = JSON.stringify({ type: "thread_typing", threadId: data.threadId, userId: sessionUserId, userName: data.userName });
            wsThreadMap.forEach((info, client) => {
              if (client !== ws && info.threadId === data.threadId && client.readyState === WebSocket.OPEN) {
                client.send(msg);
              }
            });
          }).catch(() => {});
        }
        if (data.type === "viewing_thread" && data.threadId && sessionUserId) {
          storage.getMessageThread(data.threadId).then((thread) => {
            if (!thread) return;
            if (thread.adminId !== sessionUserId && thread.customerId !== sessionUserId) {
              storage.getUser(sessionUserId).then((u) => {
                if (u?.role !== "master_admin") return;
                const prev = wsThreadMap.get(ws);
                if (prev) removeThreadViewer(prev.threadId, prev.userId);
                wsThreadMap.set(ws, { userId: sessionUserId, threadId: data.threadId });
                addThreadViewer(data.threadId, sessionUserId);
              }).catch(() => {});
              return;
            }
            const prev = wsThreadMap.get(ws);
            if (prev) removeThreadViewer(prev.threadId, prev.userId);
            wsThreadMap.set(ws, { userId: sessionUserId, threadId: data.threadId });
            addThreadViewer(data.threadId, sessionUserId);
          }).catch(() => {});
        }
        if (data.type === "left_thread" && data.threadId && sessionUserId) {
          removeThreadViewer(data.threadId, sessionUserId);
          const info = wsThreadMap.get(ws);
          if (info && info.threadId === data.threadId) wsThreadMap.delete(ws);
        }
        if (data.type === "community_typing" && sessionUserId) {
          storage.getUser(sessionUserId).then((u) => {
            if (!u) return;
            const isAdminU = u.role === "admin" || u.role === "master_admin";
            const name = isAdminU ? u.fullName : (u.chatUsername || "Anonymous");
            broadcastExcept({ type: "community_typing", userId: sessionUserId, chatUsername: name }, ws);
          }).catch(() => {});
        }
        if (data.type === "viewing_ticket" && data.ticketId && data.userId) {
          const prev = wsUserMap.get(ws);
          if (prev) {
            removeTicketViewer(prev.ticketId, prev.userId);
          }
          const role = data.userRole || "user";
          wsUserMap.set(ws, { userId: data.userId, ticketId: data.ticketId, userRole: role });
          addTicketViewer(data.ticketId, data.userId, role);
          const viewers = getTicketViewers(data.ticketId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ticket_viewers", ticketId: data.ticketId, viewers }));
          }
        }
        if (data.type === "left_ticket" && data.ticketId && data.userId) {
          removeTicketViewer(data.ticketId, data.userId);
          wsUserMap.delete(ws);
        }
      } catch {}
    });

    ws.on("close", () => {
      wsClients.delete(ws);
      const removed = presenceMap.remove(ws);
      if (removed && removed.remaining === 0) {
        broadcastPresenceToAdmins({ type: "presence_changed", userId: removed.userId, status: "offline" });
      } else if (removed) {
        broadcastPresenceToAdmins({ type: "presence_changed", userId: removed.userId, status: "tab_removed" });
      }
      const info = wsUserMap.get(ws);
      if (info) {
        removeTicketViewer(info.ticketId, info.userId);
        wsUserMap.delete(ws);
      }
      const chatInfo = wsAdminChatMap.get(ws);
      if (chatInfo) {
        removeAdminChatViewer(chatInfo.threadId, chatInfo.userId);
        wsAdminChatMap.delete(ws);
      }
      const threadInfo = wsThreadMap.get(ws);
      if (threadInfo) {
        removeThreadViewer(threadInfo.threadId, threadInfo.userId);
        wsThreadMap.delete(ws);
      }
      wsSessionUserMap.delete(ws);
      wsSessionRoleMap.delete(ws);
    });
  });

  void (async () => {
    try {
      const allFiles = await db.select({ filename: uploadedFiles.filename }).from(uploadedFiles);
      const validPaths = new Set(allFiles.map(f => `/uploads/${f.filename}`));

      const allNews = await db.select().from(newsStories).where(isNotNull(newsStories.imageUrl));
      for (const story of allNews) {
        if (story.imageUrl && !validPaths.has(story.imageUrl)) {
          await db.update(newsStories).set({ imageUrl: null }).where(eq(newsStories.id, story.id));
        }
      }

      // Reclaim the historical backlog of upload blobs no record references
      // anymore (from before per-delete cleanup existed). Safe: only deletes
      // zero-reference files via the shared reference-check list.
      const removed = await sweepOrphanedUploadedFiles();
      if (removed > 0) {
        console.log(`[cleanup] Swept ${removed} orphaned uploaded file(s) at startup`);
      }
    } catch (e) {
      console.error("Cleanup orphaned image refs failed:", e);
    }
  })();

  app.get("/api/admin/monitors", requirePermission("monitoring.view", "monitoring.manage"), async (_req, res) => {
    const monitors = await storage.getAllUrlMonitors();
    res.json(monitors);
  });

  app.get("/api/admin/monitors/:id", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const monitor = await storage.getUrlMonitor(getParam(req, "id"));
    if (!monitor) return res.status(404).json({ message: "Monitor not found" });
    res.json(monitor);
  });

  function isPrivateIP(ip: string): boolean {
    if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip === "::1" || ip === "::") return true;
    if (ip.startsWith("10.")) return true;
    if (ip.startsWith("192.168.")) return true;
    if (ip.startsWith("169.254.")) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    if (ip.startsWith("fc") || ip.startsWith("fd")) return true;
    if (ip.startsWith("fe80")) return true;
    if (ip.startsWith("100.") && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true;
    return false;
  }

  function validateMonitorUrl(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) return "Only http and https URLs are allowed";
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "::1") return "Cannot monitor localhost addresses";
      if (isPrivateIP(hostname)) return "Cannot monitor private/internal IP ranges";
      if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) return "Cannot monitor internal hostnames";
      if (/^metadata\.google\.internal/.test(hostname) || hostname === "metadata.google.internal") return "Cannot monitor cloud metadata endpoints";
      if (hostname === "169.254.169.254") return "Cannot monitor cloud metadata endpoints";
      return null;
    } catch {
      return "Invalid URL format";
    }
  }

  async function validateMonitorUrlDns(url: string): Promise<string | null> {
    const basicError = validateMonitorUrl(url);
    if (basicError) return basicError;
    try {
      const { hostname } = new URL(url);
      const dns = await import("dns");
      const { resolve4 } = dns.promises;
      const addresses = await resolve4(hostname);
      for (const addr of addresses) {
        if (isPrivateIP(addr)) return `URL resolves to private IP (${addr}) — not allowed`;
      }
    } catch {
    }
    return null;
  }

  const ALLOWED_INTERVALS = [30, 60, 120, 300, 600];
  const ALLOWED_TIMEOUTS = [5, 10, 30];
  const ALLOWED_THRESHOLDS = [1, 2, 3, 4, 5];

  const monitorUpdateSchema = z.object({
    name: z.string().min(1).optional(),
    url: z.string().url().optional(),
    monitorType: z.enum(["http_status", "url_availability"]).optional(),
    checkIntervalSeconds: z.number().int().refine(v => ALLOWED_INTERVALS.includes(v), { message: "Must be 30, 60, 120, 300, or 600" }).optional(),
    expectedStatusCode: z.number().int().min(100).max(599).optional(),
    timeoutSeconds: z.number().int().refine(v => ALLOWED_TIMEOUTS.includes(v), { message: "Must be 5, 10, or 30" }).optional(),
    consecutiveFailuresThreshold: z.number().int().min(1).max(5).optional(),
    emailNotifications: z.boolean().optional(),
    enabled: z.boolean().optional(),
    serviceId: z.string().nullable().optional(),
  });

  app.post("/api/admin/monitors", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const parsed = insertUrlMonitorSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    const urlError = await validateMonitorUrlDns(parsed.data.url);
    if (urlError) return res.status(400).json({ message: urlError });
    if (parsed.data.checkIntervalSeconds && !ALLOWED_INTERVALS.includes(parsed.data.checkIntervalSeconds)) {
      return res.status(400).json({ message: "Check interval must be 30, 60, 120, 300, or 600 seconds" });
    }
    if (parsed.data.timeoutSeconds && !ALLOWED_TIMEOUTS.includes(parsed.data.timeoutSeconds)) {
      return res.status(400).json({ message: "Timeout must be 5, 10, or 30 seconds" });
    }
    if (parsed.data.consecutiveFailuresThreshold && !ALLOWED_THRESHOLDS.includes(parsed.data.consecutiveFailuresThreshold)) {
      return res.status(400).json({ message: "Failure threshold must be between 1 and 5" });
    }
    const monitor = await storage.createUrlMonitor(parsed.data);
    logActivity("monitoring", "monitor_created", {
      actorId: req.session.userId,
      targetId: monitor.id,
      targetType: "url_monitor",
      summary: `Created URL monitor: ${monitor.name} (${monitor.url})`,
    });
    res.status(201).json(monitor);
  });

  app.patch("/api/admin/monitors/:id", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const monitor = await storage.getUrlMonitor(getParam(req, "id"));
    if (!monitor) return res.status(404).json({ message: "Monitor not found" });
    const parsed = monitorUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    if (parsed.data.url) {
      const urlError = await validateMonitorUrlDns(parsed.data.url);
      if (urlError) return res.status(400).json({ message: urlError });
    }
    const updated = await storage.updateUrlMonitor(getParam(req, "id"), parsed.data);
    logActivity("monitoring", "monitor_updated", {
      actorId: req.session.userId,
      targetId: getParam(req, "id"),
      targetType: "url_monitor",
      summary: `Updated URL monitor: ${monitor.name}`,
    });
    res.json(updated);
  });

  app.delete("/api/admin/monitors/:id", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const monitor = await storage.getUrlMonitor(getParam(req, "id"));
    if (!monitor) return res.status(404).json({ message: "Monitor not found" });
    await storage.deleteUrlMonitor(getParam(req, "id"));
    logActivity("monitoring", "monitor_deleted", {
      actorId: req.session.userId,
      targetId: getParam(req, "id"),
      targetType: "url_monitor",
      summary: `Deleted URL monitor: ${monitor.name} (${monitor.url})`,
    });
    res.json({ message: "Deleted" });
  });

  app.get("/api/admin/monitors/:id/incidents", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const incidents = await storage.getMonitorIncidents(getParam(req, "id"));
    res.json(incidents);
  });

  // ---- Per-Service uptime (Task #55) ----
  const { computeUptime: computeUptimeFn } = await import("./uptime");

  // Public per-service uptime
  app.get("/api/public/services/:id/uptime", async (req, res) => {
    try {
      const monitors = await storage.getMonitorsByService(req.params.id);
      const incArrays = await Promise.all(monitors.map((m) => storage.getMonitorIncidents(m.id)));
      const uptime = computeUptimeFn(incArrays.flat(), monitors.length > 0);
      res.json({ ...uptime, hasMonitor: monitors.length > 0 });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Logged-in service uptime block (used by /services/:id detail page)
  app.get("/api/services/:id/uptime", requireAuth, async (req, res) => {
    try {
      const monitors = await storage.getMonitorsByService(getParam(req, "id"));
      const incArrays = await Promise.all(monitors.map((m) => storage.getMonitorIncidents(m.id)));
      const uptime = computeUptimeFn(incArrays.flat(), monitors.length > 0);
      res.json({ ...uptime, hasMonitor: monitors.length > 0 });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/community-chat/messages", requireAuth, async (req, res) => {
    try {
      const limit = queryInt(req.query.limit, 50);
      const before = queryString(req.query.before);
      const messages = await storage.getCommunityMessages(limit, before);
      const messageIds = messages.map(m => m.id);
      const reactions = await storage.getCommunityReactions(messageIds);
      const reactionsByMessage: Record<string, { emoji: string; userIds: string[] }[]> = {};
      for (const r of reactions) {
        if (!reactionsByMessage[r.messageId]) reactionsByMessage[r.messageId] = [];
        const group = reactionsByMessage[r.messageId].find(g => g.emoji === r.emoji);
        if (group) group.userIds.push(r.userId);
        else reactionsByMessage[r.messageId].push({ emoji: r.emoji, userIds: [r.userId] });
      }
      const userIds = [...new Set(messages.map(m => m.userId))];
      const usersMap = new Map<string, { role: string; avatarUrl: string | null }>();
      if (userIds.length > 0) {
        const users = await storage.getUsersByIds(userIds);
        for (const u of users) usersMap.set(u.id, { role: u.role, avatarUrl: u.avatarUrl || null });
      }
      // Enrich KB article references — one lookup per unique slug, not per message.
      const kbBySlug = await enrichKbArticlesForMessages(messages, storage);
      const enriched = messages.map(m => ({
        ...m,
        reactions: reactionsByMessage[m.id] || [],
        isAdmin: ["admin", "master_admin"].includes(usersMap.get(m.userId)?.role || ""),
        avatarUrl: usersMap.get(m.userId)?.avatarUrl || null,
        kbArticle: m.kbArticleSlug ? kbBySlug.get(m.kbArticleSlug) ?? null : null,
      }));
      enriched.reverse();
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/messages", requireAuth, bypassRateLimitForAdmins, createCommunityChatPostLimiter(), withUpload("image"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.chatBanned) {
        return res.status(403).json({ error: "You have been banned from community chat" });
      }
      const rawContent = typeof req.body?.content === "string" ? req.body.content : "";
      const hasImage = !!req.file;
      const rawKbSlug = typeof req.body?.kbArticleSlug === "string" ? req.body.kbArticleSlug.trim() : "";
      const hasKbArticle = rawKbSlug.length > 0;
      // Image-only or KB-link-only messages are allowed; require text only when nothing else is attached.
      if (!hasImage && !hasKbArticle && !rawContent.trim()) {
        return res.status(400).json({ error: "Content is required" });
      }
      if (rawContent.length > 2000) {
        return res.status(400).json({ error: "Message too long (max 2000 characters)" });
      }
      if (req.file && !req.file.mimetype.startsWith("image/")) {
        return res.status(400).json({ error: "Only image attachments are supported" });
      }
      const isAdminUser = user.role === "admin" || user.role === "master_admin";
      // KB article links in community chat are admin-only — mirrors the
      // @everyone gating pattern below. Tickets allow customer-attached
      // KB links; that authorisation lives in the ticket POST handler.
      let kbArticleSlug: string | null = null;
      let kbArticleInfo: KbArticleEnvelope | null = null;
      if (hasKbArticle) {
        if (!isAdminUser) {
          return res.status(403).json({ error: "Only admins can attach knowledge base articles" });
        }
        const resolved = await resolveKbArticleAttachment(rawKbSlug, storage);
        if (!resolved.ok) {
          return res.status(resolved.status).json({ error: resolved.error });
        }
        kbArticleSlug = resolved.slug;
        kbArticleInfo = resolved.info;
      }
      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;
      const chatUsername = isAdminUser ? user.fullName : (user.chatUsername || "Anonymous");
      let trimmedContent = rawContent.trim();

      const hasEveryone = /@everyone\b/i.test(trimmedContent);
      if (hasEveryone && !isAdminUser) {
        return res.status(403).json({ error: "Only admins can use @everyone" });
      }

      const wordFilters = await storage.getAllWordFilters();
      if (wordFilters.length > 0) {
        for (const filter of wordFilters) {
          const pattern = new RegExp(filter.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
          trimmedContent = trimmedContent.replace(pattern, (match: string) => {
            if (match.length <= 3) return match[0] + "*".repeat(match.length - 1);
            return match[0] + "*".repeat(match.length - 2) + match[match.length - 1];
          });
        }
      }

      const msg = await storage.createCommunityMessage({
        userId: user.id,
        chatUsername,
        content: trimmedContent,
        imageUrl,
        kbArticleSlug,
      });
      const enriched = { ...msg, reactions: [], isAdmin: isAdminUser, kbArticle: kbArticleInfo };
      broadcast({
        type: "community_message",
        message: enriched,
      });
      res.json(enriched);

      void (async () => {
        try {
          const allUsers = await storage.getAllUsers();
          const mentionRegex = /@([a-zA-Z0-9_\-]+)/g;
          const mentionedNames = new Set<string>();
          let match;
          while ((match = mentionRegex.exec(trimmedContent)) !== null) {
            if (match[1].toLowerCase() !== "everyone") {
              mentionedNames.add(match[1].toLowerCase());
            }
          }

          const bodyText = trimmedContent
            ? (trimmedContent.length > 100 ? trimmedContent.slice(0, 100) + "…" : trimmedContent)
            : (imageUrl ? "📷 Sent an image" : "");
          const pushPayload = {
            title: `💬 ${chatUsername} in Community Chat`,
            body: bodyText,
            url: "/community",
            tag: "community-chat",
          };

          const notifMeta: NotifMeta = {
            type: "community_chat",
            referenceType: "community_message",
            referenceId: msg.id,
          };

          if (hasEveryone) {
            for (const u of allUsers) {
              if (u.id === user.id) continue;
              void sendPushToUser(u.id, {
                ...pushPayload,
                title: `📢 ${chatUsername} — @everyone`,
              }, notifMeta);
            }
          } else {
            for (const u of allUsers) {
              if (u.id === user.id) continue;

              const uChatName = (u.role === "admin" || u.role === "master_admin")
                ? u.fullName : (u.chatUsername || "");
              const isMentioned = uChatName && mentionedNames.has(uChatName.toLowerCase());

              if (u.chatNotifications === "all") {
                void sendPushToUser(u.id, pushPayload, notifMeta);
              } else if (u.chatNotifications === "mentions" && isMentioned) {
                void sendPushToUser(u.id, {
                  ...pushPayload,
                  title: `💬 ${chatUsername} mentioned you`,
                }, notifMeta);
              }
            }
          }
        } catch (e) {
          console.error("Community chat push notification error:", e);
        }
      })();
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.delete("/api/community-chat/messages/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const isAdminUser = user.role === "admin" || user.role === "master_admin";
      if (!isAdminUser) return res.status(403).json({ error: "Only admins can delete messages" });
      // Capture the attached image URL BEFORE the row is gone, then tidy up the
      // upload if no other record still references it.
      const existingMsg = await storage.getCommunityMessage(getParam(req, "id"));
      await storage.deleteCommunityMessage(getParam(req, "id"));
      await deleteUploadedFileIfUnreferenced(existingMsg?.imageUrl);
      broadcast({ type: "community_message_deleted", messageId: req.params.id });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/messages/:id/reactions", requireAuth, bypassRateLimitForAdmins, createCommunityChatReactionLimiter(), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const { emoji } = req.body;
      if (!emoji || typeof emoji !== "string") {
        return res.status(400).json({ error: "Emoji is required" });
      }
      const allowedEmojis = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👎"];
      if (!allowedEmojis.includes(emoji)) {
        return res.status(400).json({ error: "Invalid emoji" });
      }
      const messageId = getParam(req, "id");
      const result = await storage.toggleCommunityReaction(messageId, user.id, emoji);
      broadcast({
        type: "community_reaction",
        messageId,
        userId: user.id,
        emoji,
        added: result.added,
      });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  // ============ Polls ============
  const { insertPollSchema, voteSchema, POLL_PARENT_TYPES } = await import("@shared/schema");

  async function enrichPoll(pollId: string, userId: string) {
    const poll = await storage.getPollWithOptions(pollId);
    if (!poll) return null;
    const userVotes = await storage.getUserPollVotes(pollId, userId);
    return { ...poll, userVotes };
  }

  app.post("/api/polls", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "Unauthorized" });
      const isAdminUser = user.role === "admin" || user.role === "master_admin";
      if (!isAdminUser) return res.status(403).json({ error: "Only admins can create polls" });

      const parsed = insertPollSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.errors[0]?.message || "Invalid poll" });
      const data = parsed.data;
      const trimmed = data.options.map(o => o.trim()).filter(o => o.length > 0);
      if (trimmed.length < 2) return res.status(400).json({ error: "At least 2 options required" });
      if (trimmed.length > 6) return res.status(400).json({ error: "Up to 6 options allowed" });

      let parentId = data.parentId || "";
      let createdMessage: any = null;

      if (data.parentType === "news") {
        if (!parentId) return res.status(400).json({ error: "parentId required for news poll" });
        const story = await storage.getNewsStory(parentId);
        if (!story) return res.status(404).json({ error: "News story not found" });
      } else if (data.parentType === "community") {
        // Create a community message that wraps the poll
        // parentId will be the community message id
        const placeholderMessage = await storage.createCommunityMessage({
          userId: user.id,
          chatUsername: user.fullName,
          content: data.question,
        });
        parentId = placeholderMessage.id;
        createdMessage = placeholderMessage;
      }

      const poll = await storage.createPoll({
        parentType: data.parentType,
        parentId,
        question: data.question,
        multiSelect: data.multiSelect,
        closesAt: data.closesAt ? new Date(data.closesAt) : null,
        createdBy: user.id,
        options: trimmed,
      });

      if (data.parentType === "community" && createdMessage) {
        // Link poll to message
        await db.update((await import("@shared/schema")).communityMessages)
          .set({ pollId: poll.id })
          .where(eq((await import("@shared/schema")).communityMessages.id, createdMessage.id));
        const enriched = { ...createdMessage, pollId: poll.id, reactions: [], isAdmin: true };
        broadcast({ type: "community_message", message: enriched });
      } else if (data.parentType === "news") {
        broadcast({ type: "poll_created", parentType: "news", parentId, pollId: poll.id });
      }

      const enriched = await enrichPoll(poll.id, user.id);
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/polls/:id", requireAuth, async (req, res) => {
    try {
      const enriched = await enrichPoll(getParam(req, "id"), req.session.userId!);
      if (!enriched) return res.status(404).json({ error: "Poll not found" });
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/polls", requireAuth, async (req, res) => {
    try {
      const parentType = String(req.query.parentType || "");
      const parentId = String(req.query.parentId || "");
      if (!POLL_PARENT_TYPES.includes(parentType as any) || !parentId) {
        return res.status(400).json({ error: "parentType and parentId required" });
      }
      const polls = await storage.getPollsForParent(parentType, [parentId]);
      const userId = req.session.userId!;
      const enriched = await Promise.all(polls.map(async p => ({
        ...p,
        userVotes: await storage.getUserPollVotes(p.id, userId),
      })));
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/polls/:id/vote", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const poll = await storage.getPollWithOptions(getParam(req, "id"));
      if (!poll) return res.status(404).json({ error: "Poll not found" });
      if (poll.closesAt && new Date(poll.closesAt) <= new Date()) {
        return res.status(400).json({ error: "Poll is closed" });
      }
      const parsed = voteSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Invalid vote" });
      const optionIds = parsed.data.optionIds;
      const validIds = new Set(poll.options.map(o => o.id));
      for (const id of optionIds) {
        if (!validIds.has(id)) return res.status(400).json({ error: "Invalid option" });
      }
      if (!poll.multiSelect && optionIds.length > 1) {
        return res.status(400).json({ error: "Single-choice poll allows only one option" });
      }
      await storage.castPollVote(poll.id, userId, optionIds);
      const enriched = await enrichPoll(poll.id, userId);
      broadcast({ type: "poll_vote", pollId: poll.id, parentType: poll.parentType, parentId: poll.parentId });
      res.json(enriched);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.delete("/api/polls/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ error: "Only admins can delete polls" });
      }
      const poll = await storage.getPollWithOptions(getParam(req, "id"));
      if (!poll) return res.status(404).json({ error: "Poll not found" });
      await storage.deletePoll(getParam(req, "id"));
      if (poll.parentType === "community") {
        await storage.deleteCommunityMessage(poll.parentId);
        broadcast({ type: "community_message_deleted", messageId: poll.parentId });
      }
      broadcast({ type: "poll_deleted", pollId: req.params.id, parentType: poll.parentType, parentId: poll.parentId });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/community-chat/participants", requireAuth, async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const participants: { username: string; isAdmin: boolean }[] = [];
      for (const u of allUsers) {
        const isAdminUser = u.role === "admin" || u.role === "master_admin";
        const name = isAdminUser ? u.fullName : u.chatUsername;
        if (name) {
          participants.push({ username: name, isAdmin: isAdminUser });
        }
      }
      res.json(participants);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/community-chat/username-available", requireAuth, async (req, res) => {
    try {
      const username = queryString(req.query.username);
      if (!username) return res.status(400).json({ error: "Username required" });
      const taken = await storage.isChatUsernameTaken(username, req.session.userId);
      res.json({ available: !taken });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.patch("/api/community-chat/username", requireAuth, async (req, res) => {
    try {
      const { chatUsername, chatNotifications } = req.body;
      const updateData: Record<string, any> = {};
      if (chatUsername !== undefined) {
        if (!chatUsername || typeof chatUsername !== "string" || chatUsername.trim().length < 2 || chatUsername.trim().length > 20) {
          return res.status(400).json({ error: "Username must be 2-20 characters" });
        }
        const cleaned = chatUsername.trim();
        if (!/^[a-zA-Z0-9_\-]+$/.test(cleaned)) {
          return res.status(400).json({ error: "Username can only contain letters, numbers, underscores, and hyphens" });
        }
        const taken = await storage.isChatUsernameTaken(cleaned, req.session.userId);
        if (taken) return res.status(409).json({ error: "Username already taken" });
        updateData.chatUsername = cleaned;
      }
      if (chatNotifications !== undefined) {
        if (!["all", "mentions", "none"].includes(chatNotifications)) {
          return res.status(400).json({ error: "Invalid notification preference" });
        }
        updateData.chatNotifications = chatNotifications;
      }
      if (Object.keys(updateData).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }
      const updated = await storage.updateUser(req.session.userId!, updateData);
      res.json({ chatUsername: updated?.chatUsername, chatNotifications: updated?.chatNotifications });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/warn-user", requireAdmin, async (req, res) => {
    try {
      const { userId, message: warnMessage } = req.body;
      if (!userId || !warnMessage) return res.status(400).json({ error: "userId and message required" });
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      const warnRow = await storage.createUserNotification({
        userId,
        type: "warning",
        title: "⚠️ Warning from Admin",
        body: warnMessage,
        url: "/community",
      });

      void sendPushToUser(userId, {
        title: "⚠️ Community Chat Warning",
        body: warnMessage,
        url: "/community",
        tag: `community-warn-${userId}`,
      }, { notificationId: warnRow.id });

      logActivity("community_chat", "warn_user", {
        actorId: req.session.userId!,
        targetId: userId,
        targetType: "user",
        summary: `Admin warned ${targetUser.chatUsername || targetUser.fullName}: ${warnMessage}`,
      });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/ban-user", requireAdmin, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ error: "User not found" });
      if (targetUser.role === "admin" || targetUser.role === "master_admin") {
        return res.status(403).json({ error: "Cannot ban admin users" });
      }

      await storage.updateUser(userId, { chatBanned: true });

      const banRow = await storage.createUserNotification({
        userId,
        type: "warning",
        title: "🚫 Banned from Community Chat",
        body: "You have been banned from the community chat by an admin.",
        url: "/community",
      });

      void sendPushToUser(userId, {
        title: "🚫 Community Chat Ban",
        body: "You have been banned from the community chat.",
        url: "/community",
        tag: `community-ban-${userId}`,
      }, { notificationId: banRow.id });

      logActivity("community_chat", "ban_user", {
        actorId: req.session.userId!,
        targetId: userId,
        targetType: "user",
        summary: `Admin banned ${targetUser.chatUsername || targetUser.fullName} from community chat`,
      });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/unban-user", requireAdmin, async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const targetUser = await storage.getUser(userId);
      if (!targetUser) return res.status(404).json({ error: "User not found" });

      await storage.updateUser(userId, { chatBanned: false });

      logActivity("community_chat", "unban_user", {
        actorId: req.session.userId!,
        targetId: userId,
        targetType: "user",
        summary: `Admin unbanned ${targetUser.chatUsername || targetUser.fullName} from community chat`,
      });

      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/community-chat/word-filters", requireAdmin, async (_req, res) => {
    try {
      const filters = await storage.getAllWordFilters();
      res.json(filters);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.post("/api/community-chat/word-filters", requireAdmin, async (req, res) => {
    try {
      const { word } = req.body;
      if (!word || typeof word !== "string" || !word.trim()) {
        return res.status(400).json({ error: "Word is required" });
      }
      const cleaned = word.trim().toLowerCase();
      if (cleaned.length < 2) {
        return res.status(400).json({ error: "Word must be at least 2 characters" });
      }
      const existing = await storage.getAllWordFilters();
      if (existing.some(f => f.word === cleaned)) {
        return res.status(409).json({ error: "Word already in filter list" });
      }
      const filter = await storage.addWordFilter(cleaned);
      logActivity("community_chat", "word_filter_added", {
        actorId: req.session.userId!,
        summary: `Added word filter: ${cleaned}`,
      });
      res.json(filter);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.delete("/api/community-chat/word-filters/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteWordFilter(getParam(req, "id"));
      logActivity("community_chat", "word_filter_removed", {
        actorId: req.session.userId!,
        summary: `Removed word filter (ID: ${req.params.id})`,
      });
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/community-chat/user-snapshot/:userId", requireAdmin, async (req, res) => {
    try {
      const target = await storage.getUser(getParam(req, "userId"));
      if (!target || target.role === "admin" || target.role === "master_admin") {
        return res.status(404).json({ error: "Customer not found" });
      }
      const tickets = await storage.getTicketsByCustomer(target.id);
      const openTickets = tickets.filter(t => t.status === "open" || t.status === "in_progress");
      const services = await storage.getAllServices();
      const subscribedNames = (target.subscribedServices || [])
        .map(sid => services.find(s => s.id === sid)?.name)
        .filter(Boolean);
      res.json({
        fullName: target.fullName,
        email: target.email,
        username: target.username,
        chatUsername: target.chatUsername,
        createdAt: target.createdAt,
        subscribedServices: subscribedNames,
        openTickets: openTickets.length,
        totalTickets: tickets.length,
        chatBanned: target.chatBanned || false,
      });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  app.get("/api/community-chat/banned-users", requireAdmin, async (_req, res) => {
    try {
      const banned = await storage.getBannedUsers();
      const safe = banned.map(u => ({
        id: u.id,
        fullName: u.fullName,
        username: u.username,
        chatUsername: u.chatUsername,
        email: u.email,
      }));
      res.json(safe);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  });

  // Telegram settings (admin only)
  const telegramSettingsHandlers = createTelegramSettingsHandlers({ storage, logActivity });
  app.get("/api/admin/telegram-settings", requireAdmin, telegramSettingsHandlers.getAdmin);
  app.patch("/api/admin/telegram-settings", requireAdmin, telegramSettingsHandlers.patchAdmin);

  app.post("/api/admin/telegram-settings/test", requireAdmin, async (_req, res) => {
    try {
      // Bypass the enabled flag so admins can verify connectivity before turning it on
      const result = await sendTelegramTestMessage(
        `✅ <b>Test message from ServiceHub</b>\n<i>If you can see this, Telegram notifications are wired up correctly.</i>`
      );
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: getErrorMessage(e) });
    }
  });

  // Discord settings (admin only)
  const discordSettingsHandlers = createDiscordSettingsHandlers({ storage, logActivity });
  app.get("/api/admin/discord-settings", requireAdmin, discordSettingsHandlers.getAdmin);
  app.patch("/api/admin/discord-settings", requireAdmin, discordSettingsHandlers.patchAdmin);

  app.post("/api/admin/discord-settings/test", requireAdmin, async (_req, res) => {
    try {
      const result = await sendDiscordTestMessage(composeDiscordTest());
      if (!result.ok) return res.status(400).json(result);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, error: getErrorMessage(e) });
    }
  });

  // ===== WHMCS billing integration (admin only) =====
  const whmcsSettingsHandlers = createWhmcsSettingsHandlers({ storage, logActivity });
  app.get("/api/admin/whmcs-settings", requireAdmin, whmcsSettingsHandlers.getAdmin);
  app.patch("/api/admin/whmcs-settings", requireAdmin, whmcsSettingsHandlers.patchAdmin);

  // Verify connectivity + credentials. Surfaces the raw WHMCS message so an
  // admin can tell an auth failure from an IP-allowlist miss ("Invalid IP
  // <ip>") — the rejected IP is in the message itself, so we add a hint that
  // points them at the WHMCS API allowlist.
  app.post("/api/admin/whmcs-settings/test", requireAdmin, async (_req, res) => {
    try {
      const result = await testWhmcsConnection();
      if (!result.ok) {
        const isIpError = /invalid ip/i.test(result.error ?? "");
        const hint = isIpError
          ? "WHMCS rejected this server's IP. Add the IP address shown in the message above to your WHMCS API IP allowlist (Configuration → System Settings → API Credentials, or the legacy API IP access list)."
          : undefined;
        return res.status(400).json({ ok: false, error: result.error, reason: result.reason, hint });
      }
      res.json({ ok: true, totalClients: result.totalClients });
    } catch (e) {
      res.status(500).json({ ok: false, error: getErrorMessage(e) });
    }
  });

  // Free-text WHMCS client search for the manual-link picker.
  app.get("/api/admin/whmcs/clients/search", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) return res.json({ ok: true, clients: [] });
      const result = await searchWhmcsClients(q);
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error, reason: result.reason });
      res.json({ ok: true, clients: result.clients });
    } catch (e) {
      res.status(500).json({ ok: false, error: getErrorMessage(e) });
    }
  });

  // PURE read of a user's WHMCS link state. Locked response contract:
  // { configured, enabled, link, linkedClient, suggestion }. Has NO
  // side-effects (no auto-persist) and never 500s on WHMCS unreachability —
  // linkedClient/suggestion degrade to null instead. The frontend fires the
  // POST /auto-match mutation when it sees a suggestion.
  app.get("/api/admin/users/:id/whmcs", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await storage.getWhmcsSettings();
      const configured = hasWhmcsCredentials() && !!normalizeWhmcsBaseUrl(settings?.baseUrl);
      const enabled = !!settings?.enabled;
      const autoMatch = settings?.autoMatchByEmail ?? true;

      const link = user.whmcsClientId
        ? { whmcsClientId: user.whmcsClientId, whmcsLinkedAt: user.whmcsLinkedAt }
        : null;

      let linkedClient = null;
      if (configured && link) {
        const r = await getWhmcsClientById(link.whmcsClientId);
        linkedClient = r.ok ? (r.client ?? null) : null;
      }

      let suggestion = null;
      if (configured && enabled && autoMatch && !link && user.email) {
        const r = await getWhmcsClientByEmail(user.email);
        suggestion = r.ok ? (r.client ?? null) : null;
      }

      res.json({ configured, enabled, link, linkedClient, suggestion });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Manually link a user to a specific WHMCS client id. Verifies the client
  // exists and is not already linked to a different user (409).
  app.post("/api/admin/users/:id/whmcs/link", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const userId = getParam(req, "id");
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const clientId = Number(req.body?.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS client id is required" });
      }
      if (!hasWhmcsCredentials()) {
        return res.status(400).json({ message: "WHMCS is not configured" });
      }
      const lookup = await getWhmcsClientById(clientId);
      if (!lookup.ok) {
        if (lookup.reason === "not_configured") {
          return res.status(400).json({ message: "WHMCS is not configured" });
        }
        return res.status(502).json({ message: `Could not verify WHMCS client: ${lookup.error}` });
      }
      if (!lookup.client) {
        return res.status(404).json({ message: `WHMCS client #${clientId} was not found` });
      }
      const existing = await storage.getUserByWhmcsClientId(clientId);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ message: `WHMCS client #${clientId} is already linked to ${existing.username}` });
      }
      const updated = await storage.updateUser(userId, { whmcsClientId: clientId, whmcsLinkedAt: new Date() });
      logActivity("user", "whmcs_linked", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Linked ${user.username} to WHMCS client #${clientId} (${lookup.client.email || lookup.client.fullName})`,
      });
      res.json({ ok: true, link: { whmcsClientId: clientId, whmcsLinkedAt: updated?.whmcsLinkedAt ?? null }, linkedClient: lookup.client });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Remove a user's WHMCS link.
  app.delete("/api/admin/users/:id/whmcs/link", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const userId = getParam(req, "id");
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const prev = user.whmcsClientId;
      await storage.updateUser(userId, { whmcsClientId: null, whmcsLinkedAt: null });
      logActivity("user", "whmcs_unlinked", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Unlinked ${user.username} from WHMCS client${prev ? ` #${prev}` : ""}`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Auto-match a user to a WHMCS client by exact email. Idempotent: a no-op
  // (matched:false) when already linked or when there is no unambiguous match;
  // 409 when the matched client belongs to another user.
  app.post("/api/admin/users/:id/whmcs/auto-match", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const userId = getParam(req, "id");
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!hasWhmcsCredentials()) {
        return res.status(400).json({ message: "WHMCS is not configured" });
      }
      if (user.whmcsClientId) {
        const r = await getWhmcsClientById(user.whmcsClientId);
        return res.json({ ok: true, matched: false, alreadyLinked: true, link: { whmcsClientId: user.whmcsClientId, whmcsLinkedAt: user.whmcsLinkedAt }, linkedClient: r.ok ? (r.client ?? null) : null });
      }
      if (!user.email) return res.json({ ok: true, matched: false, reason: "no_email" });
      const lookup = await getWhmcsClientByEmail(user.email);
      if (!lookup.ok) {
        if (lookup.reason === "not_configured") {
          return res.status(400).json({ message: "WHMCS is not configured" });
        }
        return res.status(502).json({ message: `WHMCS lookup failed: ${lookup.error}` });
      }
      if (!lookup.client) return res.json({ ok: true, matched: false, reason: "no_match" });
      const clientId = lookup.client.id;
      const existing = await storage.getUserByWhmcsClientId(clientId);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ message: `WHMCS client #${clientId} is already linked to ${existing.username}` });
      }
      const updated = await storage.updateUser(userId, { whmcsClientId: clientId, whmcsLinkedAt: new Date() });
      logActivity("user", "whmcs_auto_matched", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Auto-matched ${user.username} to WHMCS client #${clientId} by email`,
      });
      res.json({ ok: true, matched: true, link: { whmcsClientId: clientId, whmcsLinkedAt: updated?.whmcsLinkedAt ?? null }, linkedClient: lookup.client });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ---------- Billing (read-only WHMCS) ----------
  // A clean, fully-empty billing payload. Both routes fall back to this for the
  // unconfigured / disabled / unlinked / unreachable states so the frontend
  // always receives the same locked shape and never has to branch on missing
  // keys. Callers override the few flags that differ per state.
  const emptyBilling = (over: Record<string, unknown>) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    client: null,
    balance: null,
    invoices: [],
    products: [],
    portalUrl: null,
    ...over,
  });

  // ---- Customer self-service WHMCS account linking (email-code verified) ----
  // Security model: the WHMCS client id is ALWAYS resolved server-side from the
  // email the user enters; we email a 6-digit code to the address WHMCS has on
  // file and only establish the link once that exact code is proven back. No
  // response ever echoes PII or the code, so a user can never discover or
  // attach to an account that isn't theirs. Codes are single-use, expire in 10
  // minutes, and are capped at 5 wrong attempts.
  const whmcsLinkRequestLimiter = createWhmcsLinkRequestLimiter();
  const whmcsLinkVerifyLimiter = createWhmcsLinkVerifyLimiter();
  const WHMCS_LINK_CODE_TTL_MS = 10 * 60 * 1000;
  const WHMCS_LINK_MAX_ATTEMPTS = 5;

  const whmcsLinkConfig = async () => {
    const settings = await storage.getWhmcsSettings();
    const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
    return { configured: hasWhmcsCredentials() && !!baseUrl, enabled: !!settings?.enabled };
  };

  app.get("/api/whmcs/link/status", requireAuth, async (req, res) => {
    try {
      const { configured, enabled } = await whmcsLinkConfig();
      const user = await storage.getUser(req.session.userId!);
      res.json({
        configured,
        enabled,
        linked: !!user?.whmcsClientId,
        dismissed: !!user?.whmcsLinkPromptDismissedAt,
      });
    } catch {
      res.json({ configured: false, enabled: false, linked: false, dismissed: false });
    }
  });

  app.post("/api/whmcs/link/dismiss", requireAuth, async (req, res) => {
    try {
      await storage.updateUser(req.session.userId!, { whmcsLinkPromptDismissedAt: new Date() });
      res.json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });

  app.post(
    "/api/whmcs/link/request",
    requireAuth,
    bypassRateLimitForAdmins,
    whmcsLinkRequestLimiter,
    async (req, res) => {
      try {
        const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
        if (!email) return res.status(400).json({ status: "invalid" });

        const user = await storage.getUser(req.session.userId!);
        if (!user) return res.status(401).json({ status: "unavailable" });
        if (user.whmcsClientId) return res.json({ status: "already_linked" });

        const { configured, enabled } = await whmcsLinkConfig();
        if (!configured || !enabled) return res.json({ status: "unavailable" });

        const lookup = await getWhmcsClientByEmail(email);
        if (!lookup.ok) return res.json({ status: "unavailable" });
        const client = lookup.client;
        if (!client) return res.json({ status: "no_match" });

        // Another ServiceHub user already owns this WHMCS client — refuse and
        // reveal nothing further.
        const existing = await storage.getUserByWhmcsClientId(client.id);
        if (existing && existing.id !== user.id) return res.json({ status: "conflict" });

        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const codeHash = crypto.createHash("sha256").update(code).digest("hex");
        const expiresAt = new Date(Date.now() + WHMCS_LINK_CODE_TTL_MS);
        await storage.createWhmcsLinkVerification({
          userId: user.id,
          email: client.email || email,
          codeHash,
          whmcsClientId: client.id,
          attempts: 0,
          expiresAt,
        });

        // The code always goes to the WHMCS-on-file address (authoritative);
        // for an exact match this equals what the user typed.
        void sendTemplatedEmail(
          client.email || email,
          "whmcs_link_verification",
          { code, name: client.fullName || user.fullName || "there" },
          client.fullName || user.fullName,
        );

        logActivity("user", "whmcs_link_code_requested", {
          actorId: user.id,
          summary: "Requested a code to link their billing account",
        });
        res.json({ status: "code_sent" });
      } catch {
        res.json({ status: "unavailable" });
      }
    },
  );

  app.post(
    "/api/whmcs/link/verify",
    requireAuth,
    bypassRateLimitForAdmins,
    whmcsLinkVerifyLimiter,
    async (req, res) => {
      try {
        const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
        if (!/^\d{6}$/.test(code)) return res.status(400).json({ status: "invalid_code" });

        const user = await storage.getUser(req.session.userId!);
        if (!user) return res.status(401).json({ status: "expired" });
        if (user.whmcsClientId) return res.json({ status: "already_linked" });

        const v = await storage.getActiveWhmcsLinkVerification(user.id);
        if (!v) return res.json({ status: "expired" });
        if (v.expiresAt.getTime() < Date.now()) {
          await storage.consumeWhmcsLinkVerification(v.id);
          return res.json({ status: "expired" });
        }
        if (v.attempts >= WHMCS_LINK_MAX_ATTEMPTS) {
          await storage.consumeWhmcsLinkVerification(v.id);
          return res.json({ status: "too_many_attempts" });
        }

        const candidate = crypto.createHash("sha256").update(code).digest("hex");
        const a = Buffer.from(candidate, "hex");
        const b = Buffer.from(v.codeHash, "hex");
        const match = a.length === b.length && crypto.timingSafeEqual(a, b);
        if (!match) {
          await storage.bumpWhmcsLinkVerificationAttempts(v.id);
          const attemptsRemaining = Math.max(0, WHMCS_LINK_MAX_ATTEMPTS - (v.attempts + 1));
          return res.json({ status: "invalid_code", attemptsRemaining });
        }

        // Re-check the conflict at the moment of linking — another user may have
        // claimed this WHMCS client between request and verify.
        const existing = await storage.getUserByWhmcsClientId(v.whmcsClientId);
        if (existing && existing.id !== user.id) {
          await storage.consumeWhmcsLinkVerification(v.id);
          return res.json({ status: "conflict" });
        }

        await storage.updateUser(user.id, {
          whmcsClientId: v.whmcsClientId,
          whmcsLinkedAt: new Date(),
          whmcsLinkPromptDismissedAt: new Date(),
        });
        await storage.consumeWhmcsLinkVerification(v.id);
        logActivity("user", "whmcs_self_linked", {
          actorId: user.id,
          summary: "Linked their billing account via emailed code",
        });
        res.json({ status: "linked" });
      } catch {
        res.json({ status: "expired" });
      }
    },
  );

  // Customer self-view: only ever reads the logged-in user's OWN linked WHMCS
  // client. Never accepts a clientId param, never forwards raw WHMCS error
  // strings (they can leak server IPs), and never 500s — it degrades to a clean
  // disabled / unlinked / unreachable state so the page always renders.
  app.get("/api/billing", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyBilling({ configured, enabled }));
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyBilling({ configured, enabled, linked: false }));
      }
      const summary = await loadBillingSummary(clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...summary });
    } catch {
      // Never leak / never 500 for the customer — show a clean unreachable state.
      return res.json(emptyBilling({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });

  // Customer self-view: a single invoice's full detail, scoped to the logged-in
  // user's OWN linked WHMCS client. The handler (createCustomerInvoiceDetailHandler)
  // ALWAYS derives the client id from the session user — never request input — and
  // loadInvoiceDetail rejects any invoice whose owner doesn't match (returns
  // notFound). Never 500s; degrades to a clean disabled / unlinked / unreachable /
  // notFound state.
  app.get(
    "/api/billing/invoices/:invoiceId",
    requireAuth,
    createCustomerInvoiceDetailHandler({
      getWhmcsSettings: () => storage.getWhmcsSettings(),
      getUser: (id) => storage.getUser(id),
    }),
  );

  // Customer self-view: load + save the logged-in user's OWN linked WHMCS
  // client's editable contact profile. The client id is ALWAYS derived from the
  // session user — never request input (the PATCH body carries only whitelisted
  // contact fields). GET never 500s; PATCH validates with a schema and degrades
  // cleanly when WHMCS is unconfigured/unreachable, unlinked, or the API role
  // lacks the client-update permission.
  const whmcsProfileDeps = {
    getWhmcsSettings: () => storage.getWhmcsSettings(),
    getUser: (id: string) => storage.getUser(id),
  };
  const updateWhmcsProfile = createUpdateProfileHandler(whmcsProfileDeps);
  app.get("/api/billing/profile", requireAuth, createGetProfileHandler(whmcsProfileDeps));
  app.patch("/api/billing/profile", requireAuth, async (req, res) => {
    await updateWhmcsProfile(req, res);
    const userId = req.session.userId;
    if (res.statusCode === 200 && userId) {
      logActivity("user", "whmcs_profile_updated", {
        actorId: userId,
        summary: "Updated their WHMCS account contact details",
      });
    }
  });

  // Customer invoice-PDF download proxy. Streams a single invoice's official
  // WHMCS PDF through ServiceHub (mirror-on-read — nothing stored) so the
  // customer never has to log into the WHMCS client area to read it. Ownership
  // is enforced exactly like the invoice detail read: loadInvoiceDetail rejects
  // any invoice whose owning client doesn't match the session user's linked
  // client (returns notFound), so a customer can't pull another client's PDF by
  // guessing its id. Never 500s — degrades to a clean 404 / 502 / 503.
  app.get("/api/billing/invoices/:invoiceId/pdf", requireAuth, async (req, res) => {
    try {
      const invoiceId = Number(getParam(req, "invoiceId"));
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const detail = await loadInvoiceDetail(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const dl = await getWhmcsInvoicePdf(invoiceId);
      if (!dl.ok || !dl.data) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      const buffer = Buffer.from(dl.data, "base64");
      const disposition = req.query.download === "1" ? "attachment" : "inline";
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `${disposition}; filename="invoice-${invoiceId}.pdf"`);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(buffer);
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });

  // Admin customer-detail view: a single invoice's full detail for any linked
  // customer. Permission-gated. The handler (createAdminInvoiceDetailHandler)
  // resolves the client id from the SELECTED user (the :id path param), so the
  // same ownership check applies. Read-only contract: degrades to a stable
  // unreachable state instead of 500.
  app.get(
    "/api/admin/users/:id/whmcs/billing/invoices/:invoiceId",
    requirePermission("users.view", "users.manage"),
    createAdminInvoiceDetailHandler({
      getWhmcsSettings: () => storage.getWhmcsSettings(),
      getUser: (id) => storage.getUser(id),
    }),
  );

  // Admin invoice-PDF download proxy for a linked customer. Permission-gated;
  // ownership enforced against the selected user's linked client id (same guard
  // as the customer route). Streams the PDF bytes through — nothing is stored.
  app.get(
    "/api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf",
    requirePermission("users.view", "users.manage"),
    async (req, res) => {
      try {
        const user = await storage.getUser(getParam(req, "id"));
        if (!user) return res.status(404).json({ message: "Invoice not found" });
        const invoiceId = Number(getParam(req, "invoiceId"));
        if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
          return res.status(404).json({ message: "Invoice not found" });
        }
        const settings = await storage.getWhmcsSettings();
        const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
        const configured = hasWhmcsCredentials() && !!baseUrl;
        const enabled = !!settings?.enabled;
        const clientId = user.whmcsClientId ?? null;
        if (!configured || !enabled || !clientId) {
          return res.status(404).json({ message: "Invoice not found" });
        }
        const detail = await loadInvoiceDetail(invoiceId, clientId, baseUrl);
        if (detail.unreachable) {
          return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
        }
        if (detail.notFound || !detail.invoice) {
          return res.status(404).json({ message: "Invoice not found" });
        }
        const dl = await getWhmcsInvoicePdf(invoiceId);
        if (!dl.ok || !dl.data) {
          return res.status(502).json({ message: `Could not download this invoice: ${dl.error ?? "unknown error"}` });
        }
        const buffer = Buffer.from(dl.data, "base64");
        const disposition = req.query.download === "1" ? "attachment" : "inline";
        res.set("Content-Type", "application/pdf");
        res.set("Content-Disposition", `${disposition}; filename="invoice-${invoiceId}.pdf"`);
        res.set("Cache-Control", "private, max-age=300");
        return res.send(buffer);
      } catch (e) {
        res.status(500).json({ message: getErrorMessage(e) });
      }
    },
  );

  // Admin customer-detail view: any linked customer's billing. Permission-gated
  // and MAY surface the WHMCS/storage error (it's admin-only, not customer-facing).
  app.get("/api/admin/users/:id/whmcs/billing", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyBilling({ configured, enabled, linked: !!clientId }));
      }
      const summary = await loadBillingSummary(clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...summary });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Admin billing dashboard (Task #370): fleet-wide rollup across every linked
  // customer — outstanding/overdue totals, active vs suspended services, and
  // estimated MRR, plus the list of customers who owe money. Pure / never 500:
  // it degrades to a clean unconfigured/empty/unreachable state and tolerates
  // per-customer WHMCS failures (skipped + counted, flips `partial`) so one bad
  // customer never sinks the whole dashboard.
  const emptyBillingDashboard = (over: Record<string, unknown>) => ({
    configured: false,
    enabled: false,
    unreachable: false,
    partial: false,
    generatedAt: new Date().toISOString(),
    summary: {
      linkedCustomers: 0,
      customersLoaded: 0,
      customersFailed: 0,
      totalOutstanding: 0,
      overdueAmount: 0,
      overdueInvoiceCount: 0,
      unpaidInvoiceCount: 0,
      activeServices: 0,
      suspendedServices: 0,
      estimatedMrr: 0,
      currencyCode: null,
    },
    customers: [],
    ...over,
  });

  app.get(
    "/api/admin/whmcs/billing/dashboard",
    requirePermission("users.view", "users.manage"),
    async (_req, res) => {
      try {
        const settings = await storage.getWhmcsSettings();
        const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
        const configured = hasWhmcsCredentials() && !!baseUrl;
        const enabled = !!settings?.enabled;
        if (!configured || !enabled) {
          return res.json(emptyBillingDashboard({ configured, enabled }));
        }
        const linkedUsers = await storage.getWhmcsLinkedUsers();
        const linked = linkedUsers
          .filter((u) => u.whmcsClientId != null)
          .map((u) => ({
            userId: u.id,
            fallbackName: u.fullName || u.username || u.email || `Client #${u.whmcsClientId}`,
            clientId: u.whmcsClientId as number,
          }));
        const dashboard = await loadBillingDashboard(linked, baseUrl);
        return res.json({ configured, enabled, ...dashboard });
      } catch {
        // Read-only contract: never 500 — degrade to a stable unreachable state.
        return res.json(emptyBillingDashboard({ configured: true, enabled: true, unreachable: true }));
      }
    },
  );

  // ---------- WHMCS product → service mapping (Task #335) ----------

  // List the full WHMCS product catalogue for the admin mapping picker. Returns
  // a tagged result so the UI can distinguish "unconfigured" from "WHMCS error"
  // without a 500.
  app.get("/api/admin/whmcs/products", requireAdmin, async (_req, res) => {
    try {
      if (!hasWhmcsCredentials()) {
        return res.json({ ok: false, reason: "not_configured", error: "WHMCS is not configured", products: [] });
      }
      const result = await listWhmcsProducts();
      if (!result.ok) return res.status(400).json({ ok: false, error: result.error, reason: result.reason, products: [] });
      res.json({ ok: true, products: result.products ?? [] });
    } catch (e) {
      res.status(500).json({ ok: false, error: getErrorMessage(e) });
    }
  });

  // List all product→service mappings, grouped by WHMCS product id. Pure DB
  // read — never touches WHMCS, so it works even when WHMCS is unreachable.
  app.get("/api/admin/whmcs/product-mappings", requireAdmin, async (_req, res) => {
    try {
      const rows = await storage.listWhmcsProductMappings();
      const grouped = new Map<number, string[]>();
      for (const row of rows) {
        const list = grouped.get(row.whmcsProductId) ?? [];
        list.push(row.serviceId);
        grouped.set(row.whmcsProductId, list);
      }
      const mappings = Array.from(grouped.entries()).map(([whmcsProductId, serviceIds]) => ({ whmcsProductId, serviceIds }));
      res.json({ mappings });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Create/replace the set of ServiceHub services mapped to one WHMCS product.
  // An empty serviceIds array clears the mapping. Every serviceId must exist.
  app.put("/api/admin/whmcs/product-mappings", requireAdmin, async (req, res) => {
    try {
      const whmcsProductId = Number(req.body?.whmcsProductId);
      if (!Number.isInteger(whmcsProductId) || whmcsProductId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS product id is required" });
      }
      const rawIds: unknown[] = Array.isArray(req.body?.serviceIds) ? req.body.serviceIds : [];
      const serviceIds: string[] = Array.from(new Set(rawIds.map((s) => String(s)).filter((s) => s.length > 0)));
      if (serviceIds.length > 0) {
        const all = await storage.getAllServices();
        const known = new Set(all.map((s) => s.id));
        const unknown = serviceIds.filter((id) => !known.has(id));
        if (unknown.length > 0) {
          return res.status(400).json({ message: `Unknown service id(s): ${unknown.join(", ")}` });
        }
      }
      const rows = await storage.setWhmcsProductMappingServices(whmcsProductId, serviceIds);
      logActivity("setting", "whmcs_product_mapping_set", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Mapped WHMCS product #${whmcsProductId} to ${serviceIds.length} service${serviceIds.length === 1 ? "" : "s"}`,
      });
      res.json({ ok: true, whmcsProductId, serviceIds: rows.map((r) => r.serviceId) });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Remove all mappings for a single WHMCS product.
  app.delete("/api/admin/whmcs/product-mappings/:pid", requireAdmin, async (req, res) => {
    try {
      const whmcsProductId = Number(getParam(req, "pid"));
      if (!Number.isInteger(whmcsProductId) || whmcsProductId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS product id is required" });
      }
      await storage.deleteWhmcsProductMappings(whmcsProductId);
      logActivity("setting", "whmcs_product_mapping_removed", {
        actorId: req.session.userId,
        targetType: "setting",
        summary: `Removed service mapping for WHMCS product #${whmcsProductId}`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Locked-shape derived-services payload, mirroring emptyBilling. The customer
  // and admin routes both fall back to this so the frontend never branches on
  // missing keys.
  const emptyDerivedServices = (over: Record<string, unknown>) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    services: [] as Service[],
    ...over,
  });

  // Shared orchestrator: turn a linked client's ACTIVE WHMCS products into the
  // ServiceHub monitored services they map to. No-throw — WHMCS failure surfaces
  // as unreachable:true with an empty list.
  const deriveServicesForClient = async (
    clientId: number,
  ): Promise<{ unreachable: boolean; services: Service[] }> => {
    const productsResult = await getWhmcsClientProducts(clientId);
    if (!productsResult.ok) return { unreachable: true, services: [] };
    const products = normalizeWhmcsListField(productsResult.data?.products, "product").map(parseWhmcsProduct);
    const mappings = await storage.listWhmcsProductMappings();
    const serviceIds = deriveMappedServiceIds(products, mappings);
    if (serviceIds.length === 0) return { unreachable: false, services: [] };
    const all = await storage.getAllServices();
    const byId = new Map(all.map((s) => [s.id, s]));
    const services = serviceIds.map((id) => byId.get(id)).filter((s): s is Service => !!s);
    return { unreachable: false, services };
  };

  // Customer self-view: the monitored services included with the logged-in
  // user's own active WHMCS products. Never 500s, never leaks WHMCS errors.
  app.get("/api/my/whmcs-services", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getWhmcsSettings();
      const configured = hasWhmcsCredentials() && !!normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) return res.json(emptyDerivedServices({ configured, enabled }));
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) return res.json(emptyDerivedServices({ configured, enabled, linked: false }));
      const { unreachable, services } = await deriveServicesForClient(clientId);
      return res.json({ configured, enabled, linked: true, unreachable, services });
    } catch {
      return res.json(emptyDerivedServices({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });

  // Admin customer-detail view: the monitored services derived from a specific
  // customer's active WHMCS products. Permission-gated; MAY surface errors.
  app.get("/api/admin/users/:id/whmcs/derived-services", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await storage.getWhmcsSettings();
      const configured = hasWhmcsCredentials() && !!normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyDerivedServices({ configured, enabled, linked: !!clientId }));
      }
      const { unreachable, services } = await deriveServicesForClient(clientId);
      return res.json({ configured, enabled, linked: true, unreachable, services });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ---------- Support tickets (read-on-demand WHMCS mirror) ----------
  // WHMCS tickets are mirrored on view only — never stored, never mixed with
  // native ServiceHub tickets. A clean, fully-empty payload backs every
  // unconfigured / disabled / unlinked / unreachable state so the frontend
  // always gets the same locked shape and never branches on missing keys.
  const emptyWhmcsTickets = (over: Record<string, unknown>) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    tickets: [] as unknown[],
    portalUrl: null as string | null,
    ...over,
  });

  // Customer self-view list: only ever the logged-in user's OWN linked client.
  // Never forwards raw WHMCS error strings and never 500s — degrades to a clean
  // disabled / unlinked / unreachable state so the page always renders.
  app.get("/api/whmcs-tickets", requireAuth, async (req, res) => {
    try {
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyWhmcsTickets({ configured, enabled }));
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyWhmcsTickets({ configured, enabled, linked: false }));
      }
      const list = await loadWhmcsTicketsList(clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...list });
    } catch {
      return res.json(emptyWhmcsTickets({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });

  // Customer self-view single ticket. Ownership is enforced server-side: the
  // ticket's owning WHMCS client id MUST equal the user's linked client id, so
  // a customer can never read another client's ticket by guessing an id.
  app.get("/api/whmcs-tickets/:id", requireAuth, async (req, res) => {
    try {
      const ticketId = Number(getParam(req, "id"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      return res.json({ ticket: detail });
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });

  // Customer reply: posts back to WHMCS AS the client (clientid attribution).
  // Ownership is re-verified before the write so a customer can only reply to
  // their own ticket.
  app.post("/api/whmcs-tickets/:id/reply", requireAuth, withUploadArray("attachments", WHMCS_REPLY_MAX_ATTACHMENTS), async (req, res) => {
    try {
      const ticketId = Number(getParam(req, "id"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const message = String(req.body?.message ?? "").trim();
      if (!message) {
        return res.status(400).json({ message: "A reply message is required" });
      }
      const attachments = toWhmcsAttachmentUploads(req.files as Express.Multer.File[] | undefined);
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const r = await addWhmcsTicketReplyAsClient(ticketId, clientId, message, attachments);
      if (!r.ok) {
        return res.status(502).json({ message: "Could not post your reply. Please try again shortly." });
      }
      bustWhmcsTicketsListCache(clientId);
      const updated = await loadWhmcsTicketDetail(ticketId, baseUrl);
      return res.json({ ok: true, ticket: updated ?? detail });
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });

  // Customer attachment download proxy. Streams a WHMCS ticket attachment's
  // bytes through ServiceHub (mirror-on-read — nothing stored). Ownership is
  // enforced exactly like the thread read, AND the requested (type, relatedid,
  // index) must be an attachment that actually belongs to THIS ticket, so a
  // customer can't pull attachments off another client's reply ids.
  app.get("/api/whmcs-tickets/:id/attachments", requireAuth, async (req, res) => {
    try {
      const ticketId = Number(getParam(req, "id"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const locator = parseWhmcsAttachmentLocator(req.query);
      if (!locator) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const user = await storage.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      if (!findWhmcsTicketAttachment(detail, locator.type, locator.relatedId, locator.index)) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const dl = await getWhmcsTicketAttachment(locator.type, locator.relatedId, locator.index);
      if (!dl.ok || !dl.data) {
        return res.status(502).json({ message: "Could not download this attachment. Please try again shortly." });
      }
      const buffer = Buffer.from(dl.data, "base64");
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${safeDownloadFilename(dl.filename ?? "")}"`);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(buffer);
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  });

  // Admin customer-detail ticket list for a linked customer. Permission-gated
  // and MAY surface WHMCS/storage errors (admin-only, not customer-facing).
  app.get("/api/admin/users/:id/whmcs/tickets", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyWhmcsTickets({ configured, enabled, linked: !!clientId }));
      }
      const list = await loadWhmcsTicketsList(clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...list });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Admin single ticket for a linked customer. Ownership enforced against the
  // user's linked client id, same as the customer route.
  app.get("/api/admin/users/:id/whmcs/tickets/:ticketId", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const ticketId = Number(getParam(req, "ticketId"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      return res.json({ ticket: detail });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Admin reply: posts back to WHMCS AS staff (adminusername attribution) so it
  // shows as a support response in WHMCS. Requires a WHMCS admin username to be
  // configured in Admin Portal → WHMCS; without it we fail loudly (400) rather
  // than silently misattributing the reply to the client.
  app.post("/api/admin/users/:id/whmcs/tickets/:ticketId/reply", requirePermission("users.view", "users.manage"), withUploadArray("attachments", WHMCS_REPLY_MAX_ATTACHMENTS), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const ticketId = Number(getParam(req, "ticketId"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const message = String(req.body?.message ?? "").trim();
      if (!message) {
        return res.status(400).json({ message: "A reply message is required" });
      }
      const attachments = toWhmcsAttachmentUploads(req.files as Express.Multer.File[] | undefined);
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.status(400).json({ message: "WHMCS is not configured or this user is not linked" });
      }
      const adminUsername = (settings?.adminUsername ?? "").trim();
      if (!adminUsername) {
        return res.status(400).json({ message: "Set a WHMCS admin username in Admin Portal → WHMCS to reply to WHMCS tickets from here." });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Ticket not found" });
      }
      const r = await addWhmcsTicketReplyAsAdmin(ticketId, adminUsername, message, attachments);
      if (!r.ok) {
        return res.status(502).json({ message: `Could not post reply to WHMCS: ${r.error}` });
      }
      bustWhmcsTicketsListCache(clientId);
      logActivity("user", "whmcs_ticket_reply", {
        actorId: req.session.userId,
        targetId: user.id,
        targetType: "user",
        summary: `Replied to WHMCS ticket #${detail.tid} for ${user.username}`,
      });
      const updated = await loadWhmcsTicketDetail(ticketId, baseUrl);
      return res.json({ ok: true, ticket: updated ?? detail });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // Admin attachment download proxy for a linked customer's WHMCS ticket.
  // Permission-gated; ownership enforced against the user's linked client id and
  // the requested attachment must belong to THIS ticket (same guard as the
  // customer route). Streams bytes through — nothing is stored in ServiceHub.
  app.get("/api/admin/users/:id/whmcs/tickets/:ticketId/attachments", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const user = await storage.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const ticketId = Number(getParam(req, "ticketId"));
      if (!Number.isInteger(ticketId) || ticketId <= 0) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const locator = parseWhmcsAttachmentLocator(req.query);
      if (!locator) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const settings = await storage.getWhmcsSettings();
      const baseUrl = normalizeWhmcsBaseUrl(settings?.baseUrl ?? null);
      const configured = hasWhmcsCredentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const detail = await loadWhmcsTicketDetail(ticketId, baseUrl);
      if (!detail || detail.ownerClientId !== clientId) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      if (!findWhmcsTicketAttachment(detail, locator.type, locator.relatedId, locator.index)) {
        return res.status(404).json({ message: "Attachment not found" });
      }
      const dl = await getWhmcsTicketAttachment(locator.type, locator.relatedId, locator.index);
      if (!dl.ok || !dl.data) {
        return res.status(502).json({ message: `Could not download this attachment: ${dl.error ?? "unknown error"}` });
      }
      const buffer = Buffer.from(dl.data, "base64");
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${safeDownloadFilename(dl.filename ?? "")}"`);
      res.set("Cache-Control", "private, max-age=300");
      return res.send(buffer);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ---------- Business Hours ----------
  const businessHoursHandlers = createBusinessHoursHandlers({ storage, logActivity });
  app.get("/api/business-hours/status", businessHoursHandlers.getPublicStatus);
  app.get("/api/admin/business-hours", requireAdmin, businessHoursHandlers.getAdmin);
  app.patch("/api/admin/business-hours", requireAdmin, businessHoursHandlers.patchAdmin);

  const supportAwayHandlers = createSupportAwayHandlers({ storage, logActivity });
  app.get("/api/support-away/status", supportAwayHandlers.getPublicStatus);
  app.get("/api/admin/support-away", requireAdmin, supportAwayHandlers.getAdmin);
  app.patch("/api/admin/support-away", requireAdmin, supportAwayHandlers.patchAdmin);

  // ===== Announcements =====
  app.get("/api/admin/announcements", requirePermission("announcements", "announcements"), async (_req, res) => {
    try {
      const list = await storage.listAnnouncements();
      res.json(list);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/announcements", requirePermission("announcements", "announcements"), async (req, res) => {
    try {
      const parsed = insertAnnouncementSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid announcement", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      if (!isAllowedAnnouncementPath(data.linkPath ?? null)) {
        return res.status(400).json({ message: "Invalid link path" });
      }
      const created = await storage.createAnnouncement({
        title: data.title,
        bodyHtml: sanitizeNewsContent(data.bodyHtml),
        linkPath: data.linkPath ?? null,
        linkLabel: data.linkLabel ?? null,
        frequency: data.frequency,
        active: data.active,
        createdByUserId: req.session.userId!,
      });
      logActivity("system", "announcement_created", {
        actorId: req.session.userId!,
        targetId: created.id,
        targetType: "announcement",
        summary: `Announcement created: ${created.title}`,
      });
      res.json(created);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/announcements/:id", requirePermission("announcements", "announcements"), async (req, res) => {
    try {
      const parsed = updateAnnouncementSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid announcement", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      if (data.linkPath !== undefined && !isAllowedAnnouncementPath(data.linkPath)) {
        return res.status(400).json({ message: "Invalid link path" });
      }
      const patch: UpdateAnnouncement = { ...data };
      if (patch.bodyHtml !== undefined) patch.bodyHtml = sanitizeNewsContent(patch.bodyHtml);
      const updated = await storage.updateAnnouncement(getParam(req, "id"), patch);
      if (!updated) return res.status(404).json({ message: "Announcement not found" });
      logActivity("system", "announcement_updated", {
        actorId: req.session.userId!,
        targetId: updated.id,
        targetType: "announcement",
        summary: `Announcement updated: ${updated.title}${data.active !== undefined ? ` (active=${updated.active})` : ""}`,
      });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/announcements/:id", requirePermission("announcements", "announcements"), async (req, res) => {
    try {
      const existing = await storage.getAnnouncement(getParam(req, "id"));
      await storage.deleteAnnouncement(getParam(req, "id"));
      logActivity("system", "announcement_deleted", {
        actorId: req.session.userId!,
        targetId: getParam(req, "id"),
        targetType: "announcement",
        summary: `Announcement deleted: ${existing?.title || req.params.id}`,
      });
      res.json({ message: "Announcement deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/announcements/active", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
      const active = await storage.getActiveAnnouncement();
      res.set("Cache-Control", "no-store");
      if (!active) return res.json(null);
      const alreadySeen = await storage.hasUserSeenAnnouncement(active.id, req.session.userId);
      res.json({ ...active, alreadySeen });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/announcements/:id/dismiss", async (req, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
      const u = await storage.getUser(req.session.userId);
      if (!u || u.role !== "customer") return res.status(403).json({ message: "Forbidden" });
      await storage.markAnnouncementSeen(req.params.id, req.session.userId);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  // ===== Knowledge Base =====
  app.get("/api/kb/categories", requireAuth, async (_req, res) => {
    try {
      const list = await storage.listKbCategories();
      res.json(list);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/kb/articles", requireAuth, async (req, res) => {
    try {
      const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
      const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : undefined;
      const u = await storage.getUser(req.session.userId!);
      const isStaff = u?.role === "admin" || u?.role === "master_admin";
      const publishedOnly = !isStaff;
      if (search) {
        const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10) || 20, 50);
        const rows = await storage.searchKbArticles(search, { limit, publishedOnly });
        const filtered = categoryId ? rows.filter(r => r.categoryId === categoryId) : rows;
        return res.json(filtered);
      }
      const list = await storage.listKbArticles({ publishedOnly, categoryId });
      res.json(list);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/kb/articles/:slug", requireAuth, async (req, res) => {
    try {
      const article = await storage.getKbArticleBySlug(getParam(req, "slug"));
      if (!article) return res.status(404).json({ message: "Article not found" });
      const u = await storage.getUser(req.session.userId!);
      const isStaff = u?.role === "admin" || u?.role === "master_admin";
      if (!article.published && !isStaff) return res.status(404).json({ message: "Article not found" });
      if (!isStaff) {
        storage.incrementKbArticleViewCount(article.id).catch(() => {});
      }
      res.json(article);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/kb/articles/:slug/helpful", requireAuth, async (req, res) => {
    try {
      const article = await storage.getKbArticleBySlug(getParam(req, "slug"));
      if (!article || !article.published) return res.status(404).json({ message: "Article not found" });
      const helpful = req.body?.helpful === true || req.body?.helpful === "true";
      const updated = await storage.recordKbArticleHelpful(article.id, helpful);
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/kb/categories", requirePermission("knowledge_base", "knowledge_base"), async (_req, res) => {
    try {
      res.json(await storage.listKbCategories());
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  const kbAdminHandlers = createKbAdminHandlers({ storage, logActivity, sanitizeHtml: sanitizeNewsContent });
  app.post("/api/admin/kb/categories", requirePermission("knowledge_base", "knowledge_base"), kbAdminHandlers.postCategory);
  app.patch("/api/admin/kb/categories/:id", requirePermission("knowledge_base", "knowledge_base"), kbAdminHandlers.patchCategory);

  app.delete("/api/admin/kb/categories/:id", requirePermission("knowledge_base", "knowledge_base"), async (req, res) => {
    try {
      const existing = await storage.getKbCategory(getParam(req, "id"));
      await storage.deleteKbCategory(getParam(req, "id"));
      logActivity("system", "kb_category_deleted", {
        actorId: req.session.userId!,
        targetId: getParam(req, "id"),
        targetType: "kb_category",
        summary: `KB category deleted: ${existing?.name || req.params.id}`,
      });
      res.json({ message: "Category deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.get("/api/admin/kb/articles", requirePermission("knowledge_base", "knowledge_base"), async (req, res) => {
    try {
      const categoryId = typeof req.query.categoryId === "string" && req.query.categoryId ? req.query.categoryId : undefined;
      res.json(await storage.listKbArticles({ categoryId }));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/kb/articles", requirePermission("knowledge_base", "knowledge_base"), kbAdminHandlers.postArticle);
  app.patch("/api/admin/kb/articles/:id", requirePermission("knowledge_base", "knowledge_base"), kbAdminHandlers.patchArticle);

  app.delete("/api/admin/kb/articles/:id", requirePermission("knowledge_base", "knowledge_base"), async (req, res) => {
    try {
      const existing = await storage.getKbArticleById(getParam(req, "id"));
      await storage.deleteKbArticle(getParam(req, "id"));
      logActivity("system", "kb_article_deleted", {
        actorId: req.session.userId!,
        targetId: getParam(req, "id"),
        targetType: "kb_article",
        summary: `KB article deleted: ${existing?.title || req.params.id}`,
      });
      res.json({ message: "Article deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  async function notifyAdminsMonitorDown(monitor: { id: string; name: string; url: string; emailNotifications: boolean }, reason: string) {
    const allUsers = await storage.getAllUsers();
    const admins = allUsers.filter(u => u.role === "admin" || u.role === "master_admin");
    const failureTime = format(new Date(), "MMM d, yyyy h:mm a");

    for (const admin of admins) {
      if (!adminWantsPush(admin, "admin_monitor_down")) continue;
      void sendPushToUser(admin.id, {
        title: `⚠️ ${monitor.name} is DOWN`,
        body: reason,
        url: `/admin?tab=monitoring&monitor=${monitor.id}`,
        tag: `monitor-${monitor.id}-down`,
      }, { type: "monitor_down", referenceType: "url_monitor", referenceId: monitor.id });
    }

    if (monitor.emailNotifications) {
      const adminEmails = admins
        .filter(a => a.email && !shouldSuppressNotification({ user: a, categoryKey: "admin_monitor_down" }))
        .map(a => a.email!);
      if (adminEmails.length > 0) {
        const rendered = await renderTemplate("monitor_down", {
          monitor_name: monitor.name,
          monitor_url: monitor.url,
          failure_reason: reason,
          failure_time: failureTime,
        });
        if (rendered) {
          await sendEmailToMultiple(adminEmails, rendered.subject, rendered.body);
        }
      }
    }

    logActivity("monitoring", "monitor_down", {
      targetId: monitor.id,
      targetType: "url_monitor",
      summary: `Monitor ${monitor.name} is DOWN: ${reason}`,
    });
  }

  async function notifyAdminsMonitorUp(monitor: { id: string; name: string; url: string; emailNotifications: boolean }, downtimeSeconds: number) {
    const allUsers = await storage.getAllUsers();
    const admins = allUsers.filter(u => u.role === "admin" || u.role === "master_admin");
    const recoveryTime = format(new Date(), "MMM d, yyyy h:mm a");

    const hours = Math.floor(downtimeSeconds / 3600);
    const mins = Math.floor((downtimeSeconds % 3600) / 60);
    const secs = downtimeSeconds % 60;
    const parts: string[] = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);
    const downtimeDuration = parts.join(" ");

    for (const admin of admins) {
      if (!adminWantsPush(admin, "admin_monitor_down")) continue;
      void sendPushToUser(admin.id, {
        title: `✅ ${monitor.name} is back UP`,
        body: `Recovered after ${downtimeDuration}`,
        url: `/admin?tab=monitoring&monitor=${monitor.id}`,
        tag: `monitor-${monitor.id}-up`,
      }, { type: "monitor_up", referenceType: "url_monitor", referenceId: monitor.id });
    }

    if (monitor.emailNotifications) {
      const adminEmails = admins
        .filter(a => a.email && !shouldSuppressNotification({ user: a, categoryKey: "admin_monitor_down" }))
        .map(a => a.email!);
      if (adminEmails.length > 0) {
        const rendered = await renderTemplate("monitor_up", {
          monitor_name: monitor.name,
          monitor_url: monitor.url,
          recovery_time: recoveryTime,
          downtime_duration: downtimeDuration,
        });
        if (rendered) {
          await sendEmailToMultiple(adminEmails, rendered.subject, rendered.body);
        }
      }
    }

    logActivity("monitoring", "monitor_up", {
      targetId: monitor.id,
      targetType: "url_monitor",
      summary: `Monitor ${monitor.name} recovered after ${downtimeDuration}`,
    });
  }

  async function checkSingleMonitor(monitor: Awaited<ReturnType<typeof storage.getUrlMonitor>> & {}) {
    if (!monitor.enabled) return;

    const now = new Date();
    const lastCheck = monitor.lastCheckedAt ? new Date(monitor.lastCheckedAt).getTime() : 0;
    if (now.getTime() - lastCheck < monitor.checkIntervalSeconds * 1000) return;

    let isUp = false;
    let failureReason = "";
    let responseTimeMs = 0;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), monitor.timeoutSeconds * 1000);
      const start = Date.now();

      if (monitor.monitorType === "http_status") {
        const response = await fetch(monitor.url, {
          method: "HEAD",
          signal: controller.signal,
          redirect: "manual",
        });
        responseTimeMs = Date.now() - start;
        clearTimeout(timeout);

        if (response.status === monitor.expectedStatusCode) {
          isUp = true;
        } else if (response.status >= 300 && response.status < 400) {
          failureReason = `HTTP ${response.status} redirect (expected ${monitor.expectedStatusCode}). Use the final URL instead.`;
        } else {
          failureReason = `HTTP ${response.status} (expected ${monitor.expectedStatusCode})`;
        }
      } else {
        const response = await fetch(monitor.url, {
          method: "GET",
          signal: controller.signal,
          redirect: "follow",
        });
        responseTimeMs = Date.now() - start;
        clearTimeout(timeout);

        if (response.status < 500) {
          isUp = true;
        } else {
          failureReason = `HTTP ${response.status} server error`;
        }
      }
    } catch (err) {
      if (getErrorName(err) === "AbortError") {
        failureReason = `Timeout after ${monitor.timeoutSeconds}s`;
      } else {
        failureReason = getErrorMessage(err) || "Connection failed";
      }
    }

    const prevStatus = monitor.status;
    let newConsecutiveFailures = isUp ? 0 : monitor.consecutiveFailures + 1;
    let newStatus = monitor.status;

    if (isUp) {
      newStatus = "up";
    } else if (newConsecutiveFailures >= monitor.consecutiveFailuresThreshold) {
      newStatus = "down";
    }

    await storage.updateUrlMonitor(monitor.id, {
      lastCheckedAt: now,
      lastResponseTimeMs: isUp ? responseTimeMs : null,
      consecutiveFailures: newConsecutiveFailures,
      status: newStatus,
      lastStatusChange: newStatus !== prevStatus ? now : monitor.lastStatusChange,
    });

    if (newStatus === "down" && prevStatus !== "down") {
      // Guard against creating duplicate open incidents (e.g. if a previous
      // check raced with this one and already opened one).
      const existingOpen = await storage.getOpenIncident(monitor.id);
      if (!existingOpen) {
        const incident = await storage.createMonitorIncident({
          monitorId: monitor.id,
          startedAt: now,
          failureReason,
          notifiedDown: false,
          notifiedUp: false,
        });
        await notifyAdminsMonitorDown(monitor, failureReason);
        await storage.updateMonitorIncident(incident.id, { notifiedDown: true });
      }
    }

    // Auto-resolve ANY open incidents whenever the monitor is currently up.
    // This is more forgiving than only resolving on the down→up transition:
    // it cleans up stale incidents left behind by races, server restarts, or
    // status drift, so the UI never shows "Ongoing" while green.
    if (isUp) {
      const openIncidents = await storage.getOpenIncidents(monitor.id);
      for (const openIncident of openIncidents) {
        const downtimeSeconds = Math.round((now.getTime() - new Date(openIncident.startedAt).getTime()) / 1000);
        if (!openIncident.notifiedUp && prevStatus === "down") {
          await notifyAdminsMonitorUp(monitor, downtimeSeconds);
        }
        await storage.updateMonitorIncident(openIncident.id, {
          resolvedAt: now,
          durationSeconds: downtimeSeconds,
          notifiedUp: true,
        });
      }
    }
  }

  async function runMonitoringLoop() {
    try {
      const monitors = await storage.getAllUrlMonitors();
      for (const monitor of monitors) {
        try {
          await checkSingleMonitor(monitor);
        } catch (err) {
          console.error(`Monitor check error for ${monitor.name}:`, err);
        }
      }
    } catch (err) {
      console.error("Monitoring loop error:", err);
    }
  }

  setTimeout(() => void runMonitoringLoop(), 5000);
  setInterval(() => void runMonitoringLoop(), 15000);

  return httpServer;
}
