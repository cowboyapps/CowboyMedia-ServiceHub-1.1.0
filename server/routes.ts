import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server, ServerResponse } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from "ws";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { db } from "./db";
import { uploadedFiles, newsStories, tickets, ticketMessages, insertServiceUpdateSchema, insertDownloadSchema, insertUrlMonitorSchema, userNotifications } from "@shared/schema";
import { z } from "zod";
import { eq, isNotNull, and, notInArray } from "drizzle-orm";
import multer from "multer";
import path from "path";
import crypto from "crypto";
import { promisify } from "util";
import webpush from "web-push";
import { sendEmail, sendEmailToMultiple, renderTemplate, getDefaultTemplate } from "./email";
import { format } from "date-fns";

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const scryptAsync = promisify(crypto.scrypt);

async function sendTemplatedEmail(
  to: string | string[],
  templateKey: string,
  variables: Record<string, string>,
  recipientName?: string,
): Promise<void> {
  const rendered = await renderTemplate(templateKey, variables);
  if (rendered && !rendered.enabled) return;
  const fallback = !rendered ? getDefaultTemplate(templateKey) : null;
  const tpl = rendered || fallback;
  if (!tpl) return;
  const subject = rendered ? tpl.subject : replaceVarsSimple(tpl.subject, variables);
  const body = rendered ? tpl.body : replaceVarsSimple(tpl.body, variables);
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

function replaceVarsSimple(template: string, variables: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => variables[key] !== undefined ? variables[key] : match);
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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  const user = await storage.getUser(req.session.userId);
  if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

async function requireMasterAdmin(req: Request, res: Response, next: NextFunction) {
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
  return async (req: Request, res: Response, next: NextFunction) => {
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
  webpush.setVapidDetails(
    "mailto:admin@servicehub.app",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

interface NotifMeta {
  type: string;
  referenceType?: string;
  referenceId?: string;
}

async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }, notif?: NotifMeta) {
  if (notif) {
    storage.createUserNotification({
      userId,
      type: notif.type,
      title: payload.title,
      body: payload.body,
      referenceType: notif.referenceType || null,
      referenceId: notif.referenceId || null,
      url: payload.url || null,
    }).catch(e => console.error("[UserNotif] Failed to create:", e.message));
  }
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
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await storage.deletePushSubscription(sub.endpoint);
          console.log(`[Push] User ${userId} — removed stale subscription (${err.statusCode})`);
        } else {
          console.error(`[Push] User ${userId} — push failed (${err.statusCode}):`, err.message);
        }
        failed++;
      }
    }
    console.log(`[Push] User ${userId} — ${sent} sent, ${failed} failed out of ${subs.length} subscription(s)`);
    if (sent > 0) {
      const pushRecipient = await storage.getUser(userId);
      logActivity("push", "push_sent", { recipientId: userId, summary: `Push to ${pushRecipient?.fullName || "user"}: ${payload.title} — ${payload.body}`, details: JSON.stringify({ recipientName: pushRecipient?.fullName || null, ...payload }) });
    }
  } catch (e) {
    console.error(`[Push] User ${userId} — error:`, e);
  }
}

async function sendPushToSubscribedUsers(serviceId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  try {
    const allUsers = await storage.getAllUsers();
    const subscribedUsers = allUsers.filter(u => u.subscribedServices?.includes(serviceId));
    for (const user of subscribedUsers) {
      await sendPushToUser(user.id, payload);
    }
  } catch (e) {
    console.error("Push notification error:", e);
  }
}

function logActivity(category: string, action: string, opts: { actorId?: string; targetId?: string; targetType?: string; recipientId?: string; summary: string; details?: string }) {
  storage.createActivityLog({ category, action, ...opts }).catch(e => console.error("[ActivityLog] Failed to write:", e.message));
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const PgStore = ConnectPgSimple(session);

  pool.query("UPDATE users SET username = TRIM(username) WHERE username != TRIM(username)")
    .then((r) => { if (r.rowCount && r.rowCount > 0) console.log(`[Migration] Trimmed whitespace from ${r.rowCount} username(s)`); })
    .catch((e) => console.error("[Migration] Failed to trim usernames:", e.message));
  pool.query("UPDATE users SET full_name = TRIM(full_name) WHERE full_name != TRIM(full_name)")
    .then((r) => { if (r.rowCount && r.rowCount > 0) console.log(`[Migration] Trimmed whitespace from ${r.rowCount} full_name(s)`); })
    .catch((e) => console.error("[Migration] Failed to trim full_names:", e.message));

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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Auth routes
  app.post("/api/auth/register", async (req, res) => {
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
      const { password: _, ...safe } = user;
      res.json(safe);
      logActivity("user", "user_registered", { targetId: user.id, targetType: "user", summary: `New user registered: ${fullName} (${username})`, details: JSON.stringify({ username, email, fullName }) });

      const allUsers = await storage.getAllUsers();
      const admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
      for (const admin of admins) {
        sendPushToUser(admin.id, {
          title: "New Customer Signup",
          body: `${fullName} (${username}) just created an account`,
          url: "/admin",
          tag: `signup-${user.id}`,
        });
      }
      const adminEmails = admins.map(a => a.email).filter(Boolean);
      if (adminEmails.length > 0) {
        sendTemplatedEmail(adminEmails, "admin_new_signup", {
          customer_name: fullName,
          customer_username: username,
          customer_email: email,
        }, "Admins");
      }
      const adminIds = admins.map(a => a.id);
      storage.createContentNotificationBulk(adminIds, "admin-users", `New signup: ${fullName} (${username})`, user.id).catch(() => {});
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const username = req.body.username?.trim();
      const { password } = req.body;
      const user = await storage.getUserByUsername(username);
      if (!user || !(await verifyPassword(password, user.password))) {
        return res.status(401).json({ message: "Invalid credentials" });
      }
      req.session.userId = user.id;
      const { password: _, ...safe } = user;
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
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
      const replitDomains = process.env.REPLIT_DOMAINS;
      let baseUrl: string;
      if (replitDomains) {
        const primaryDomain = replitDomains.split(",")[0];
        baseUrl = `https://${primaryDomain}`;
      } else if (process.env.NODE_ENV === "production") {
        return res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
      } else {
        baseUrl = `http://localhost:5000`;
      }
      const resetLink = `${baseUrl}/reset-password?token=${rawToken}`;
      sendTemplatedEmail(user.email, "password_reset", {
        fullName: user.fullName,
        resetLink,
        expiryMinutes: "60",
      }, user.fullName);
      logActivity("user", "password_reset_requested", { targetId: user.id, targetType: "user", summary: `Password reset requested for ${user.fullName} (${user.username})` });
      res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
    } catch (e: any) {
      res.json({ message: "If an account with that username or email exists, a password reset link has been sent." });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
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
    } catch (e: any) {
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
    const { password: _, ...safe } = user;
    res.json(safe);
  });

  app.patch("/api/auth/settings", requireAuth, async (req, res) => {
    try {
      const { subscribedServices, fullName, emailNotifications, setupReminderDismissed } = req.body;
      const updateData: any = {};
      if (subscribedServices !== undefined) updateData.subscribedServices = subscribedServices;
      if (fullName !== undefined) updateData.fullName = fullName?.trim();
      if (emailNotifications !== undefined) updateData.emailNotifications = emailNotifications;
      if (setupReminderDismissed !== undefined) updateData.setupReminderDismissed = setupReminderDismissed;
      const updated = await storage.updateUser(req.session.userId!, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safe } = updated;
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Public API routes
  app.get("/api/services", requireAuth, async (_req, res) => {
    const result = await storage.getAllServices();
    res.json(result);
  });

  app.get("/api/alerts", requireAuth, async (_req, res) => {
    const result = await storage.getAllAlerts();
    res.json(result);
  });

  app.get("/api/alerts/:id", requireAuth, async (req, res) => {
    const alert = await storage.getAlert(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  });

  app.get("/api/alerts/:id/updates", requireAuth, async (req, res) => {
    const updates = await storage.getAlertUpdates(req.params.id);
    res.json(updates);
  });

  app.get("/api/news", requireAuth, async (_req, res) => {
    const result = await storage.getAllNews();
    res.json(result);
  });

  app.get("/api/news/:id", requireAuth, async (req, res) => {
    const story = await storage.getNewsStory(req.params.id);
    if (!story) return res.status(404).json({ message: "Story not found" });
    res.json(story);
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
      const enriched = await Promise.all(result.map(async (t) => {
        if (t.claimedBy) {
          const claimedAdmin = await storage.getUser(t.claimedBy);
          return { ...t, claimedByName: claimedAdmin?.fullName || "Unknown" };
        }
        return { ...t, claimedByName: null };
      }));
      res.json(enriched);
    } else {
      const result = await storage.getTicketsByCustomer(user.id);
      res.json(result);
    }
  });

  app.get("/api/tickets/:id", requireAuth, async (req, res) => {
    const ticket = await storage.getTicket(req.params.id);
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
  });

  app.post("/api/tickets", requireAuth, upload.single("image"), async (req, res) => {
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
        sendPushToUser(admin.id, {
          title: "New Support Ticket",
          body: `${customer?.fullName}: ${ticket.subject}`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
        });
        storage.createTicketNotification({
          userId: admin.id,
          ticketId: ticket.id,
          type: "new_ticket",
          message: `New ticket from ${customer?.fullName}: ${ticket.subject}`,
        });
        if (admin.email && customer) {
          sendTemplatedEmail(admin.email, "admin_new_ticket", {
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

      const autoReplyText = "Thank you for contacting CowboyMedia support through our ServiceHub app. We will review your support ticket and respond as quickly as possible. Thank you!";
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

        sendPushToUser(req.session.userId!, {
          title: "New Ticket Reply",
          body: `Reply on: ${ticket.subject}`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
        }, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
        storage.createTicketNotification({
          userId: req.session.userId!,
          ticketId: ticket.id,
          type: "ticket_reply",
          message: `New reply on: ${ticket.subject}`,
        });
        if (customer?.email && customer.emailNotifications !== false) {
          sendTemplatedEmail(customer.email, "customer_ticket_received", {
            ticket_subject: ticket.subject,
            customer_name: customer.fullName,
          }, customer.fullName);
        }
      } catch (autoReplyErr) {
        console.error("Auto-reply error:", autoReplyErr);
      }

      res.json(ticket);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/tickets/:id", requireAuth, async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.id);
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
      const updated = await storage.updateTicket(req.params.id, data);
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
          const allMessages = await storage.getTicketMessages(ticket.id);
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
          sendPushToUser(admin.id, {
            title: "Ticket Closed",
            body: `Ticket Closed: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
            tag: `ticket-${ticket.id}`,
          });
          storage.createTicketNotification({
            userId: admin.id,
            ticketId: ticket.id,
            type: "ticket_closed",
            message: `Ticket closed: ${ticket.subject}`,
          });
          if (admin.email && customer) {
            sendTemplatedEmail(admin.email, "admin_ticket_closed", {
              customer_name: customer.fullName,
              customer_username: customer.username,
              customer_email: customer.email || "",
              ticket_subject: escapeHtml(ticket.subject),
              ticket_description: escapeHtml(ticket.description),
              opened_date: openedDate,
              closed_date: closedDate,
              closed_by: closedByLabel,
              resolution_summary: resolutionHtml,
              conversation: conversationHtml,
            }, admin.fullName);
          }
        }

        if (customer?.email && customer.emailNotifications !== false) {
          try {
            sendTemplatedEmail(customer.email, "ticket_transcript", {
              ticket_subject: escapeHtml(ticket.subject),
              ticket_description: escapeHtml(ticket.description),
              customer_name: customer.fullName,
              opened_date: openedDate,
              closed_date: closedDate,
              resolution_summary: resolutionHtml,
              conversation: conversationHtml,
            }, customer.fullName);
          } catch (transcriptErr) {
            console.error("Transcript email error:", transcriptErr);
          }
        }
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tickets/:id/claim", requirePermission("support_tickets"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.id);
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

      const updated = await storage.updateTicket(req.params.id, { claimedBy: admin.id });
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      broadcast({ type: "ticket_updated", ticket: updated });
      const claimCustomer = await storage.getUser(ticket.customerId);
      logActivity("ticket", "ticket_claimed", { actorId: admin.id, targetId: ticket.id, targetType: "ticket", summary: `${admin.fullName} claimed ticket: "${ticket.subject}" (customer: ${claimCustomer?.fullName || "Unknown"})`, details: JSON.stringify({ admin: admin.fullName, customer: claimCustomer?.fullName, customerEmail: claimCustomer?.email, subject: ticket.subject }) });

      const pendingTransfer = await storage.getPendingTransferByTicketId(req.params.id);
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

      sendPushToUser(ticket.customerId, {
        title: pushTitle,
        body: pushBody,
        url: `/tickets/${ticket.id}`,
        tag: `ticket-${ticket.id}`,
      }, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
      storage.createTicketNotification({
        userId: ticket.customerId,
        ticketId: ticket.id,
        type: isTransfer ? "ticket_transferred" : "ticket_claimed",
        message: isTransfer
          ? `Your ticket has been transferred to ${admin.fullName}: ${ticket.subject}`
          : `${admin.fullName} claimed your ticket: ${ticket.subject}`,
      });

      const customer = await storage.getUser(ticket.customerId);
      if (customer?.email && customer.emailNotifications !== false) {
        const emailTemplate = isTransfer ? "customer_ticket_transferred" : "customer_ticket_claimed";
        sendTemplatedEmail(customer.email, emailTemplate, {
          admin_name: admin.fullName,
          ticket_subject: ticket.subject,
          customer_name: customer.fullName,
        }, customer.fullName);
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tickets/:id/transfer", requirePermission("support_tickets"), async (req, res) => {
    try {
      const { toAdminId, reason } = req.body;
      if (!toAdminId || !reason) return res.status(400).json({ message: "Target admin and reason are required" });
      const ticket = await storage.getTicket(req.params.id);
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

      await storage.updateTicket(req.params.id, { claimedBy: null });

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

      sendPushToUser(toAdminId, {
        title: "Ticket Transfer",
        body: `${admin.fullName} transferred a ticket to you: ${ticket.subject} — Reason: ${reason}`,
        url: `/tickets/${ticket.id}`,
        tag: `ticket-transfer-${ticket.id}`,
      });

      storage.createTicketNotification({
        userId: toAdminId,
        ticketId: ticket.id,
        type: "ticket_transfer",
        message: `Ticket transferred from ${admin.fullName}: ${ticket.subject}`,
      });

      if (targetAdmin.email && targetAdmin.emailNotifications !== false) {
        sendTemplatedEmail(targetAdmin.email, "admin_ticket_transfer", {
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/support-admins", requirePermission("support_tickets"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const admins = allUsers
        .filter(u => (u.role === "admin" || u.role === "master_admin") && u.id !== req.session.userId)
        .map(u => ({ id: u.id, fullName: u.fullName }));
      res.json(admins);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tickets/:id/messages", requireAuth, async (req, res) => {
    const ticket = await storage.getTicket(req.params.id);
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
    const messages = await storage.getTicketMessages(req.params.id);
    const senderIds = [...new Set(messages.map(m => m.senderId))];
    const senderMap = new Map<string, { name: string; role: string }>();
    await Promise.all(senderIds.map(async (id) => {
      const sender = await storage.getUser(id);
      if (sender) senderMap.set(id, { name: sender.fullName, role: sender.role });
    }));
    const enriched = messages.map(m => ({
      ...m,
      senderName: senderMap.get(m.senderId)?.name || "Unknown",
      senderRole: senderMap.get(m.senderId)?.role || "customer",
    }));
    res.json(enriched);
  });

  app.get("/api/admin/customers/:customerId/tickets", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const customerTickets = await storage.getTicketsByCustomer(req.params.customerId);
      const excludeId = req.query.excludeTicketId as string | undefined;
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/tickets/:id/customer", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const ticket = await storage.getTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const customer = await storage.getUser(ticket.customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      const { password: _, ...safeCustomer } = customer;
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tickets/:id/messages", requireAuth, upload.single("image"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.id);
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
      if (user.role === "master_admin" && ticket.claimedBy && ticket.claimedBy !== user.id) {
        const existingMessages = await storage.getTicketMessages(req.params.id);
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
      const message = await storage.createTicketMessage({
        ticketId: req.params.id,
        senderId: req.session.userId!,
        message: req.body.message,
        imageUrl: imageUrl || null,
      });
      const msgCustomer = isAdmin ? await storage.getUser(ticket.customerId) : user;
      logActivity("ticket", "ticket_message", { actorId: req.session.userId!, targetId: ticket.id, targetType: "ticket", summary: `Message on ticket "${ticket.subject}" by ${user.fullName} (customer: ${msgCustomer?.fullName || "Unknown"})`, details: JSON.stringify({ sender: user.fullName, customer: msgCustomer?.fullName, subject: ticket.subject }) });
      broadcast({ type: "ticket_message", ticketId: req.params.id, message });
      if (isAdmin) {
        sendPushToUser(ticket.customerId, {
          title: "New Ticket Reply",
          body: `Reply on: ${ticket.subject}`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
        }, { type: "ticket_update", referenceType: "ticket", referenceId: ticket.id });
        storage.createTicketNotification({
          userId: ticket.customerId,
          ticketId: ticket.id,
          type: "ticket_reply",
          message: `New reply on: ${ticket.subject}`,
        });
        const customer = await storage.getUser(ticket.customerId);
        if (customer?.email && customer.emailNotifications !== false && !isUserViewingTicket(ticket.customerId, ticket.id)) {
          if (shouldSendTicketEmail(ticket.customerId, ticket.id)) {
            recordTicketEmailSent(ticket.customerId, ticket.id);
            sendTemplatedEmail(customer.email, "customer_ticket_reply", {
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
          sendPushToUser(admin.id, {
            title: "New Ticket Message",
            body: `${user.fullName}: ${ticket.subject}`,
            url: `/tickets/${ticket.id}`,
            tag: `ticket-${ticket.id}`,
          });
          storage.createTicketNotification({
            userId: admin.id,
            ticketId: ticket.id,
            type: "ticket_reply",
            message: `${user.fullName} replied: ${ticket.subject}`,
          });
          if (admin.email && !isUserViewingTicket(admin.id, ticket.id)) {
            if (shouldSendTicketEmail(admin.id, ticket.id)) {
              recordTicketEmailSent(admin.id, ticket.id);
              sendTemplatedEmail(admin.email, "admin_ticket_reply", {
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
      res.json(message);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Admin routes
  app.get("/api/admin/users", requirePermission("users.view", "users.manage"), async (_req, res) => {
    const result = await storage.getAllUsers();
    const safe = result.map(({ password: _, ...u }) => u);
    res.json(safe);
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
      const { password: _, ...safe } = user;
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/users/:id", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const data = { ...req.body };
      if (data.username) data.username = data.username.trim();
      if (data.fullName) data.fullName = data.fullName.trim();
      const updated = await storage.updateUser(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safe } = updated;
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/users/:id/password", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      const { password } = req.body;
      if (!password || password.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
      }
      const hashed = await hashPassword(password);
      const updated = await storage.updateUser(req.params.id, { password: hashed });
      if (!updated) return res.status(404).json({ message: "User not found" });
      res.json({ message: "Password reset successfully" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/users/:id", requirePermission("users.view", "users.manage"), async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ message: "User deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/services", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      const service = await storage.createService(req.body);
      res.json(service);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/services/:id", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      const existing = await storage.getService(req.params.id);
      if (!existing) return res.status(404).json({ message: "Service not found" });
      const updated = await storage.updateService(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Service not found" });
      if (req.body.status && req.body.status !== existing.status) {
        const allUsers = await storage.getAllUsers();
        const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(existing.id));
        const subIds = subscribedCustomers.map(u => u.id);
        for (const u of subscribedCustomers) {
          sendPushToUser(u.id, {
            title: "Service Status Update",
            body: `${updated.name}: ${updated.status}`,
            url: "/services",
            tag: `service-${updated.id}`,
          }, { type: "service_status", referenceType: "service", referenceId: updated.id });
          if (u.email && u.emailNotifications !== false) {
            sendTemplatedEmail(u.email, "customer_service_status", {
              service_name: updated.name,
              service_status: updated.status,
              customer_name: u.fullName,
            }, u.fullName);
          }
        }
        storage.createContentNotificationBulk(subIds, "services", `${updated.name}: ${updated.status}`, updated.id).catch(() => {});
      }
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/services/:id", requirePermission("services.view", "services.manage"), async (req, res) => {
    try {
      await storage.deleteService(req.params.id);
      res.json({ message: "Service deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/alerts", requirePermission("alerts.view", "alerts.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const { sendPush, sendEmail, serviceImpact, ...alertData } = req.body;
      const parsedSendPush = sendPush === "false" ? false : sendPush !== false;
      const parsedSendEmail = sendEmail === "false" ? false : sendEmail !== false;
      if (imageUrl) alertData.imageUrl = imageUrl;
      const alert = await storage.createAlert(alertData);
      const impact = serviceImpact || "degraded";
      await storage.updateService(alert.serviceId, { status: impact });
      const service = await storage.getService(alert.serviceId);
      const serviceName = service?.name || "Service";
      const impactLabel = impact === "outage" ? "Outage" : impact === "maintenance" ? "Maintenance" : "Degraded Performance";
      logActivity("alert", "alert_created", { actorId: req.session.userId!, targetId: alert.id, targetType: "alert", summary: `Alert created: ${alert.title} (${serviceName} — ${impactLabel})`, details: JSON.stringify({ title: alert.title, description: alert.description, severity: alert.severity, service: serviceName, impact }) });
      broadcast({ type: "new_alert", alert });
      broadcast({ type: "service_updated", serviceId: alert.serviceId });
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.subscribedServices?.includes(alert.serviceId) && u.id !== req.session.userId);
      console.log(`[Alert Create] Alert ${alert.id} — sendPush=${parsedSendPush}, ${subscribers.length} subscriber(s)`);
      for (const u of subscribers) {
        if (parsedSendPush) {
          await sendPushToUser(u.id, {
            title: `${serviceName}: ${impactLabel}`,
            body: alert.title,
            url: `/alerts/${alert.id}`,
            tag: `alert-${alert.id}`,
          }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: alert.id } : undefined);
        }
        if (parsedSendEmail && u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceName}: ${impactLabel}`,
            alert_description: `${alert.title}\n\n${alert.description}`,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const subIds = subscribers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", `${serviceName}: ${impactLabel} — ${alert.title}`, alert.id).catch(() => {});
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/alerts/:id", requirePermission("alerts.view", "alerts.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const data: Record<string, any> = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.severity !== undefined) data.severity = req.body.severity;
      if (imageUrl) data.imageUrl = imageUrl;
      if (req.body.removeImage === "true") data.imageUrl = null;
      const updated = await storage.updateAlert(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/alerts/:id/updates", requirePermission("alerts.view", "alerts.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const { sendPush, sendEmail, serviceImpact, ...updateData } = req.body;
      const parsedSendPush = sendPush === "false" ? false : sendPush !== false;
      const parsedSendEmail = sendEmail === "false" ? false : sendEmail !== false;
      const update = await storage.createAlertUpdate({
        alertId: req.params.id,
        message: updateData.message,
        status: updateData.status,
        ...(imageUrl ? { imageUrl } : {}),
      });
      if (updateData.status === "resolved") {
        await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      } else {
        await storage.updateAlert(req.params.id, { status: updateData.status });
      }
      broadcast({ type: "alert_update", alertId: req.params.id, update });
      logActivity("alert", updateData.status === "resolved" ? "alert_resolved" : "alert_updated", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert ${updateData.status === "resolved" ? "resolved" : "updated"}: ${updateData.message?.substring(0, 100)}`, details: JSON.stringify({ status: updateData.status, message: updateData.message, serviceImpact }) });
      const alert = await storage.getAlert(req.params.id);
      if (alert) {
        const service = await storage.getService(alert.serviceId);
        const serviceName = service?.name || "Service";
        if (updateData.status === "resolved") {
          await storage.updateService(alert.serviceId, { status: "operational" });
          broadcast({ type: "service_updated", serviceId: alert.serviceId });
        } else if (serviceImpact && serviceImpact !== "no_change") {
          await storage.updateService(alert.serviceId, { status: serviceImpact });
          broadcast({ type: "service_updated", serviceId: alert.serviceId });
        }
        const isResolved = updateData.status === "resolved";
        const impactLabels: Record<string, string> = { operational: "Operational", degraded: "Degraded", outage: "Outage", maintenance: "Maintenance" };
        const hasImpactChange = !isResolved && serviceImpact && serviceImpact !== "no_change";
        const impactLabel = hasImpactChange ? impactLabels[serviceImpact] || serviceImpact : null;
        const pushTitle = isResolved
          ? `${serviceName}: Resolved — Now Operational`
          : impactLabel
            ? `${serviceName}: ${impactLabel} — ${alert.title}`
            : `${serviceName} Alert Update: ${alert.title}`;
        const emailTitle = isResolved
          ? `${serviceName}: Issue Resolved — Service Restored`
          : impactLabel
            ? `${serviceName}: ${impactLabel} — ${alert.title}`
            : `${serviceName} Update: ${alert.title}`;
        const allUsers = await storage.getAllUsers();
        const subscribers = allUsers.filter(u => u.subscribedServices?.includes(alert.serviceId) && u.id !== req.session.userId);
        console.log(`[Alert Update] Alert ${req.params.id} — status=${updateData.status}, sendPush=${parsedSendPush}, ${subscribers.length} subscriber(s)`);
        for (const u of subscribers) {
          if (parsedSendPush || isResolved) {
            await sendPushToUser(u.id, {
              title: pushTitle,
              body: updateData.message,
              url: `/alerts/${req.params.id}`,
              tag: `alert-${req.params.id}`,
            }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: req.params.id } : undefined);
          }
          if ((parsedSendEmail || isResolved) && u.email && u.emailNotifications !== false) {
            sendTemplatedEmail(u.email, "customer_service_alert", {
              alert_title: emailTitle,
              alert_description: updateData.message,
              customer_name: u.fullName,
            }, u.fullName);
          }
        }
        const subIds = subscribers.map(u => u.id);
        const notifMsg = isResolved
          ? `${serviceName}: Resolved — ${alert.title}`
          : `${serviceName} Update: ${alert.title}`;
        storage.createContentNotificationBulk(subIds, "alerts", notifMsg, alert.id).catch(() => {});
      }
      res.json(update);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/alerts/:alertId/updates/:updateId", requirePermission("alerts.view", "alerts.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const data: Record<string, any> = {};
      if (req.body.message !== undefined) data.message = req.body.message;
      if (imageUrl) data.imageUrl = imageUrl;
      if (req.body.removeImage === "true") data.imageUrl = null;
      const updated = await storage.updateAlertUpdate(req.params.updateId, data);
      if (!updated) return res.status(404).json({ message: "Alert update not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/alerts/:id/resolve", requirePermission("alerts.view", "alerts.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const resolveMessage = req.body?.message || "Issue has been resolved.";
      const updated = await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      await storage.createAlertUpdate({
        alertId: req.params.id,
        message: resolveMessage,
        status: "resolved",
        ...(imageUrl ? { imageUrl } : {}),
      });
      await storage.updateService(updated.serviceId, { status: "operational" });
      const service = await storage.getService(updated.serviceId);
      const serviceName = service?.name || "Service";
      logActivity("alert", "alert_resolved", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert resolved: ${updated.title} (${serviceName})`, details: JSON.stringify({ title: updated.title, resolveMessage, service: serviceName }) });
      broadcast({ type: "alert_resolved", alertId: req.params.id });
      broadcast({ type: "service_updated", serviceId: updated.serviceId });
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.subscribedServices?.includes(updated.serviceId) && u.id !== req.session.userId);
      console.log(`[Alert Resolve] Alert ${req.params.id} — ${subscribers.length} subscriber(s) to notify`);
      for (const u of subscribers) {
        await sendPushToUser(u.id, {
          title: `${serviceName}: Resolved — Now Operational`,
          body: `${updated.title} has been resolved. Service is back to operational.`,
          url: `/alerts/${req.params.id}`,
          tag: `alert-${req.params.id}`,
        }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: req.params.id } : undefined);
        if (u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceName}: Issue Resolved — Service Restored`,
            alert_description: `${updated.title} has been resolved. Service is back to operational.`,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const subIds = subscribers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", `${serviceName}: Resolved — ${updated.title}`, updated.id).catch(() => {});
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/alerts/:id", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      const alertToDelete = await storage.getAlert(req.params.id);
      await storage.deleteAlert(req.params.id);
      logActivity("alert", "alert_deleted", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert deleted: ${alertToDelete?.title || req.params.id}` });
      res.json({ message: "Alert deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
        sendPushToUser(u.id, {
          title: `Service Update: ${serviceName}`,
          body: title,
          url: "/service-updates",
          tag: `service-update-${update.id}`,
        }, { type: "service_update", referenceType: "service_update", referenceId: update.id });
        if (u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_update", {
            service_name: serviceName,
            update_title: title,
            update_description: description,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const subIds = subscribedCustomers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "service-updates", title, update.id).catch(() => {});
      res.json(update);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/service-updates/:id", requirePermission("service_updates.view", "service_updates.manage"), async (req, res) => {
    try {
      const { title, description, matureContent } = req.body;
      const data: Partial<{ title: string; description: string; matureContent: boolean }> = {};
      if (title !== undefined) data.title = title;
      if (description !== undefined) data.description = description;
      if (matureContent !== undefined) data.matureContent = matureContent;
      const updated = await storage.updateServiceUpdate(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "Service update not found" });
      logActivity("service_update", "service_update_edited", { actorId: req.session.userId!, targetId: req.params.id, targetType: "service_update", summary: `Service update edited: ${updated.title}` });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/service-updates/:id", requireAuth, async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (user && (user.role === "admin" || user.role === "master_admin")) {
        if (req.body?.hideOnly) {
          await storage.hideServiceUpdate(req.session.userId!, req.params.id);
          return res.json({ message: "Service update hidden for you" });
        }
        await storage.deleteServiceUpdate(req.params.id);
        logActivity("service_update", "service_update_deleted", { actorId: req.session.userId!, targetId: req.params.id, targetType: "service_update", summary: `Service update deleted` });
        return res.json({ message: "Service update deleted" });
      }
      await storage.hideServiceUpdate(req.session.userId!, req.params.id);
      res.json({ message: "Service update hidden" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/news", requirePermission("news.view", "news.manage"), upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const story = await storage.createNewsStory({
        title: req.body.title,
        content: req.body.content,
        imageUrl: imageUrl || null,
        authorId: req.session.userId!,
      });
      logActivity("news", "news_created", { actorId: req.session.userId!, targetId: story.id, targetType: "news", summary: `News story created: ${story.title}`, details: JSON.stringify({ title: story.title, content: story.content?.substring(0, 200) }) });
      broadcast({ type: "new_news", story });
      const allUsers = await storage.getAllUsers();
      for (const u of allUsers.filter(u => u.role === "customer")) {
        sendPushToUser(u.id, {
          title: "New News Story",
          body: story.title,
          url: `/news/${story.id}`,
          tag: `news-${story.id}`,
        }, { type: "news", referenceType: "news", referenceId: story.id });
      }
      const customerEmails = allUsers.filter(u => u.role === "customer" && u.email && u.emailNotifications !== false).map(u => u.email);
      if (customerEmails.length > 0) {
        sendTemplatedEmail(customerEmails, "customer_news", {
          story_title: story.title,
          story_content: story.content,
        }, "Customers");
      }
      const customerIds = allUsers.filter(u => u.role === "customer").map(u => u.id);
      storage.createContentNotificationBulk(customerIds, "news", story.title, story.id).catch(() => {});
      res.json(story);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/news/:id", requirePermission("news.view", "news.manage"), upload.single("image"), async (req, res) => {
    try {
      const existing = await storage.getNewsStory(req.params.id);
      if (!existing) return res.status(404).json({ message: "News story not found" });

      const updateData: any = {};
      if (req.body.title) updateData.title = req.body.title;
      if (req.body.content) updateData.content = req.body.content;
      if (req.file) {
        updateData.imageUrl = await saveUploadedFile(req.file);
      } else if (req.body.removeImage === "true") {
        updateData.imageUrl = null;
      }

      const updated = await storage.updateNewsStory(req.params.id, updateData);
      logActivity("news", "news_edited", { actorId: req.session.userId!, targetId: req.params.id, targetType: "news", summary: `News story edited: ${updated?.title || req.params.id}` });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/news/:id", requirePermission("news.view", "news.manage"), async (req, res) => {
    try {
      const storyToDelete = await storage.getNewsStory(req.params.id);
      await storage.deleteNewsStory(req.params.id);
      logActivity("news", "news_deleted", { actorId: req.session.userId!, targetId: req.params.id, targetType: "news", summary: `News story deleted: ${storyToDelete?.title || req.params.id}` });
      res.json({ message: "News story deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Delete ticket route (admin only)
  app.delete("/api/admin/tickets/:id", requirePermission("support_tickets"), async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (ticket.status !== "closed") {
        return res.status(400).json({ message: "Only closed tickets can be deleted" });
      }
      await storage.deleteTicket(req.params.id);
      res.json({ message: "Ticket deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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

      sendPushToUser(recipientId, {
        title: "New Private Message",
        body: `${sender?.fullName}: ${subject}`,
        url: "/messages",
        tag: `pm-${message.id}`,
      });

      if (recipient.email && recipient.emailNotifications !== false && sender) {
        sendTemplatedEmail(recipient.email, "customer_private_message", {
          sender_name: sender.fullName,
          message_subject: subject,
          message_body: body,
          customer_name: recipient.fullName,
        }, recipient.fullName);
      }

      res.json(message);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/private-messages/sent", requirePermission("messages.view", "messages.manage"), async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesBySender(req.session.userId!);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/private-messages/:id", requirePermission("messages.view", "messages.manage"), async (req, res) => {
    try {
      const sentMessages = await storage.getPrivateMessagesBySender(req.session.userId!);
      const msg = sentMessages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      await storage.deletePrivateMessage(req.params.id);
      res.json({ message: "Message deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // === Message Threads (Conversational Messaging) ===

  app.post("/api/message-threads", requirePermission("messages.manage"), async (req, res) => {
    try {
      const { customerId, subject, body } = req.body;
      if (!customerId || !subject || !body) {
        return res.status(400).json({ message: "customerId, subject, and body are required" });
      }
      const customer = await storage.getUser(customerId);
      if (!customer) return res.status(404).json({ message: "Customer not found" });
      if (customer.role !== "customer") return res.status(400).json({ message: "Can only start conversations with customers" });

      const thread = await storage.createMessageThread({
        adminId: req.session.userId!,
        customerId,
        subject,
      });

      const msg = await storage.createThreadMessage({
        threadId: thread.id,
        senderId: req.session.userId!,
        body,
      });

      const sender = await storage.getUser(req.session.userId!);
      broadcastToThreadParticipants({ type: "thread_message", threadId: thread.id, message: { ...msg, senderName: sender?.fullName || "Admin" } }, [thread.adminId, thread.customerId]);

      sendPushToUser(customerId, {
        title: `Message from ${sender?.fullName || "Support"}`,
        body: `${subject}: ${body.substring(0, 100)}`,
        url: `/messages/${thread.id}`,
        tag: `thread-${thread.id}`,
      }, { type: "message", referenceType: "message_thread", referenceId: thread.id });

      if (customer.email && customer.emailNotifications !== false && sender) {
        sendTemplatedEmail(customer.email, "customer_thread_message", {
          sender_name: sender.fullName,
          thread_subject: subject,
          message_body: body,
          customer_name: customer.fullName,
        }, customer.fullName);
      }

      logActivity("messages", "thread_created", { actorId: req.session.userId!, targetId: thread.id, targetType: "message_thread", summary: `Started conversation "${subject}" with ${customer.fullName}` });

      res.json({ thread, message: msg });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/message-threads/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadThreadMessageCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/message-threads/:id", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(req.params.id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const admin = await storage.getUser(thread.adminId);
      const customer = await storage.getUser(thread.customerId);
      res.json({ ...thread, adminName: admin?.fullName || "Admin", customerName: customer?.fullName || "Customer" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/message-threads/:id/messages", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(req.params.id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser2 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser2?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const messages = await storage.getThreadMessages(req.params.id);
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/message-threads/:id/messages", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(req.params.id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser3 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser3?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      const { body } = req.body;
      if (!body || !body.trim()) return res.status(400).json({ message: "Message body is required" });

      const msg = await storage.createThreadMessage({
        threadId: thread.id,
        senderId: req.session.userId!,
        body: body.trim(),
      });

      await storage.updateMessageThread(thread.id, { lastMessageAt: new Date() });

      const sender = await storage.getUser(req.session.userId!);
      broadcastToThreadParticipants({ type: "thread_message", threadId: thread.id, message: { ...msg, senderName: sender?.fullName || "User" } }, [thread.adminId, thread.customerId]);

      const recipientId = thread.adminId === req.session.userId ? thread.customerId : thread.adminId;
      const isRecipientViewing = isUserViewingThread(recipientId, thread.id);

      const recipientUser = await storage.getUser(recipientId);
      const recipientIsCustomer = recipientUser?.role === "customer";
      sendPushToUser(recipientId, {
        title: `${sender?.fullName || "User"}`,
        body: body.trim().substring(0, 100),
        url: `/messages/${thread.id}`,
        tag: `thread-${thread.id}`,
      }, recipientIsCustomer ? { type: "message", referenceType: "message_thread", referenceId: thread.id } : undefined);

      if (!isRecipientViewing) {
        const recipient = await storage.getUser(recipientId);
        if (recipient?.email && recipient.emailNotifications !== false && sender) {
          const isAdminSending = req.session.userId === thread.adminId;
          const templateKey = isAdminSending ? "customer_thread_message" : "admin_thread_message";
          sendTemplatedEmail(recipient.email, templateKey, {
            sender_name: sender.fullName,
            thread_subject: thread.subject,
            message_body: body.trim(),
            customer_name: isAdminSending ? recipient.fullName : sender.fullName,
          }, recipient.fullName);
        }
      }

      res.json(msg);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/message-threads/:id/read", requireAuth, async (req, res) => {
    try {
      const thread = await storage.getMessageThread(req.params.id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const reqUser4 = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && thread.customerId !== req.session.userId && reqUser4?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.markThreadMessagesRead(req.params.id, req.session.userId!);
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/message-threads/:id", requirePermission("messages.manage"), async (req, res) => {
    try {
      const thread = await storage.getMessageThread(req.params.id);
      if (!thread) return res.status(404).json({ message: "Thread not found" });
      const delUser = await storage.getUser(req.session.userId!);
      if (thread.adminId !== req.session.userId && delUser?.role !== "master_admin") {
        return res.status(403).json({ message: "Forbidden" });
      }
      await storage.deleteMessageThread(req.params.id);
      res.json({ message: "Thread deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/quick-responses", requirePermission("quick_responses.view", "quick_responses.manage"), async (req, res) => {
    try {
      const responses = await storage.getAllQuickResponses();
      res.json(responses);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/quick-responses", requirePermission("quick_responses.view", "quick_responses.manage"), async (req, res) => {
    try {
      const { title, message } = req.body;
      if (!title || !message) return res.status(400).json({ message: "Title and message are required" });
      const qr = await storage.createQuickResponse({ title, message });
      res.json(qr);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/quick-responses/:id", requirePermission("quick_responses.view", "quick_responses.manage"), async (req, res) => {
    try {
      const { title, message } = req.body;
      const updated = await storage.updateQuickResponse(req.params.id, { title, message });
      if (!updated) return res.status(404).json({ message: "Quick response not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/quick-responses/:id", requirePermission("quick_responses.view", "quick_responses.manage"), async (req, res) => {
    try {
      await storage.deleteQuickResponse(req.params.id);
      res.json({ message: "Quick response deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/quick-responses", requireAuth, async (req, res) => {
    try {
      const responses = await storage.getAllQuickResponses();
      res.json(responses);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/report-requests", requireAuth, upload.single("image"), async (req, res) => {
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

      if (user.email && user.emailNotifications !== false) {
        sendTemplatedEmail(user.email, "customer_report_received", {
          type_label: typeLabel,
          service_name: service?.name || "N/A",
          report_title: title,
          report_description_block: description ? `<blockquote>${description}</blockquote>` : "",
          customer_name: user.fullName,
        }, user.fullName);
      }

      const allUsers = await storage.getAllUsers();
      const admins = allUsers.filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support");
      for (const admin of admins) {
        sendPushToUser(admin.id, {
          title: `New ${typeLabel}`,
          body: `${user.fullName}: ${title}`,
          url: "/admin",
          tag: `report-request-${rr.id}`,
        });
        if (admin.email) {
          sendTemplatedEmail(admin.email, "admin_new_report", {
            type_label: typeLabel,
            type_label_lower: typeLabel.toLowerCase(),
            customer_name: user.fullName,
            customer_username: user.username,
            customer_email: user.email,
            service_name: service?.name || "N/A",
            report_title: title,
            report_description_block: description ? `<blockquote>${description}</blockquote>` : "",
          }, admin.fullName);
        }
      }
      const adminIds = admins.map(a => a.id);
      storage.createContentNotificationBulk(adminIds, "admin-reports", `${typeLabel}: ${title}`, rr.id).catch(() => {});

      res.json(rr);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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

      const updated = await storage.updateReportRequest(req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "Not found" });
      if (status) {
        const reportCustomer = existing.customerId ? await storage.getUser(existing.customerId) : null;
        logActivity("report", "report_status_changed", { actorId: req.session.userId!, targetId: req.params.id, targetType: "report", summary: `Report "${existing.title}" by ${reportCustomer?.fullName || "Unknown"} status changed to ${status}`, details: JSON.stringify({ customer: reportCustomer?.fullName, customerEmail: reportCustomer?.email, title: existing.title, oldStatus: existing.status, newStatus: status, adminNotes }) });
      }

      if (status && status !== existing.status) {
        const typeLabelsMap: Record<string, string> = {
          content_issue: "Content Issue Report",
          movie_request: "Movie/Series Request",
          app_issue: "App Issue / Feature Request",
        };
        const typeLabel = typeLabelsMap[existing.type] || existing.type;
        const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

        sendPushToUser(existing.customerId, {
          title: `${typeLabel} Updated`,
          body: `Your ${typeLabel.toLowerCase()} "${existing.title}" has been marked as ${statusLabel}`,
          url: "/report-request",
          tag: `report-${existing.id}`,
        }, { type: "report_update", referenceType: "report_request", referenceId: existing.id });

        storage.createReportNotification({
          userId: existing.customerId,
          reportRequestId: existing.id,
          message: `Your ${typeLabel.toLowerCase()} "${existing.title}" has been updated to ${statusLabel}`,
        });

        const customer = await storage.getUser(existing.customerId);
        if (customer?.email && customer.emailNotifications !== false) {
          const notesBlock = adminNotes ? `<blockquote>${adminNotes}</blockquote>` : (updated.adminNotes ? `<blockquote>${updated.adminNotes}</blockquote>` : "");
          sendTemplatedEmail(customer.email, "customer_report_update", {
            type_label: typeLabel,
            report_title: existing.title,
            status_label: statusLabel,
            admin_notes_block: notesBlock,
            customer_name: customer.fullName,
          }, customer.fullName);
        }
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/report-notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadReportNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/report-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await storage.markReportNotificationsRead(req.session.userId!);
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/report-requests/:id", requirePermission("reports.view", "reports.manage"), async (req, res) => {
    try {
      const reportToDelete = await storage.getAllReportRequests().then(all => all.find(r => r.id === req.params.id));
      const delCustomer = reportToDelete?.customerId ? await storage.getUser(reportToDelete.customerId) : null;
      await storage.deleteReportRequest(req.params.id);
      logActivity("report", "report_deleted", { actorId: req.session.userId!, targetId: req.params.id, targetType: "report", summary: `Report deleted: "${reportToDelete?.title || req.params.id}" by ${delCustomer?.fullName || "Unknown"}`, details: JSON.stringify({ title: reportToDelete?.title, customer: delCustomer?.fullName }) });
      res.json({ message: "Deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/email-templates", requirePermission("email_templates.view", "email_templates.manage"), async (_req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
      const updated = await storage.updateEmailTemplate(req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/email-templates/:id/reset", requirePermission("email_templates.view", "email_templates.manage"), async (req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      const template = templates.find(t => t.id === req.params.id);
      if (!template) return res.status(404).json({ message: "Template not found" });
      const defaultTpl = getDefaultTemplate(template.templateKey);
      if (!defaultTpl) return res.status(404).json({ message: "Default template not found" });
      const updated = await storage.updateEmailTemplate(req.params.id, {
        subject: defaultTpl.subject,
        body: defaultTpl.body,
        customized: false,
      });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/roles", requireAdmin, async (_req, res) => {
    try {
      const roles = await storage.getAllAdminRoles();
      res.json(roles);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/roles", requireMasterAdmin, async (req, res) => {
    try {
      const { name, permissions } = req.body;
      const role = await storage.createAdminRole({ name, permissions: permissions || [] });
      res.json(role);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/roles/:id", requireMasterAdmin, async (req, res) => {
    try {
      const { name, permissions } = req.body;
      const updated = await storage.updateAdminRole(req.params.id, { name, permissions });
      if (!updated) return res.status(404).json({ message: "Role not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/roles/:id", requireMasterAdmin, async (req, res) => {
    try {
      await storage.deleteAdminRole(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/ticket-categories", requireAuth, async (_req, res) => {
    try {
      const categories = await storage.getAllTicketCategories();
      res.json(categories);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/ticket-categories", requireMasterAdmin, async (req, res) => {
    try {
      const { name, description, assignedRoleIds } = req.body;
      const cat = await storage.createTicketCategory({ name, description, assignedRoleIds: assignedRoleIds || [] });
      res.json(cat);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/ticket-categories/:id", requireMasterAdmin, async (req, res) => {
    try {
      const { name, description, assignedRoleIds } = req.body;
      const updated = await storage.updateTicketCategory(req.params.id, { name, description, assignedRoleIds });
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/ticket-categories/:id", requireMasterAdmin, async (req, res) => {
    try {
      await storage.deleteTicketCategory(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
        const subs = await storage.getPushSubscriptionsByUser(userId);
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              JSON.stringify({ title: "Urgent Admin Alert", body: message, url: "/" })
            );
            sent++;
          } catch (err: any) {
            if (err.statusCode === 410) {
              await storage.deletePushSubscription(sub.endpoint);
            }
          }
        }
      }
      res.json({ success: true, sent });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/broadcasts/unread", requireAuth, async (req, res) => {
    try {
      const broadcasts = await storage.getUnreadBroadcasts(req.session.userId!);
      res.json(broadcasts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/broadcasts/:id/acknowledge", requireAuth, async (req, res) => {
    try {
      await storage.markBroadcastRead(req.params.id, req.session.userId!);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/users/:id/role", requireMasterAdmin, async (req, res) => {
    try {
      const targetUser = await storage.getUser(req.params.id);
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
      const updated = await storage.updateUser(req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "User not found" });
      if (role !== undefined) {
        logActivity("user", "user_role_changed", { actorId: req.session.userId!, targetId: targetUser.id, targetType: "user", summary: `${targetUser.fullName} role changed to ${role}`, details: JSON.stringify({ username: targetUser.username, oldRole: targetUser.role, newRole: role, adminRoleId }) });
      }
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/chat/users", requirePermission("admin_chat"), async (req, res) => {
    try {
      const allUsers = await storage.getAllUsers();
      const adminUsers = allUsers
        .filter(u => (u.role === "admin" || u.role === "master_admin") && u.username !== "cowboymedia-support" && u.id !== req.session.userId)
        .map(u => ({ id: u.id, username: u.username, fullName: u.fullName, role: u.role }));
      res.json(adminUsers);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/chat/unread-count", requirePermission("admin_chat"), async (req, res) => {
    try {
      const count = await storage.getAdminChatUnreadCounts(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/chat/unread-threads", requirePermission("admin_chat"), async (req, res) => {
    try {
      const threadIds = await storage.getAdminChatUnreadThreadIds(req.session.userId!);
      res.json(threadIds);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/chat/threads/:id/read", requirePermission("admin_chat"), async (req, res) => {
    try {
      await storage.markAdminChatThreadRead(req.params.id, req.session.userId!);
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/chat/threads/:id/messages", requirePermission("admin_chat"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "master_admin") {
        const participants = await storage.getAdminChatParticipants(req.params.id);
        if (!participants.some(p => p.userId === user.id)) {
          return res.status(403).json({ message: "Not a participant" });
        }
      }
      const messages = await storage.getAdminChatMessages(req.params.id);
      const enriched = await Promise.all(messages.map(async (msg) => {
        const sender = await storage.getUser(msg.senderId);
        return { ...msg, senderName: sender?.fullName || "Unknown" };
      }));
      res.json(enriched);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/chat/threads/:id/messages", requirePermission("admin_chat"), upload.single("file"), async (req, res) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      if (user.role !== "master_admin") {
        const participants = await storage.getAdminChatParticipants(req.params.id);
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
        threadId: req.params.id,
        senderId: req.session.userId!,
        message: req.body.message || "",
        fileUrl,
        fileType,
      });
      const participants = await storage.getAdminChatParticipants(req.params.id);
      broadcast({
        type: "admin_chat_message",
        threadId: req.params.id,
        message: { ...msg, senderName: user.fullName },
        participantIds: participants.map(p => p.userId),
      });

      const thread = await storage.getAdminChatThread(req.params.id);
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
        if (!isUserViewingAdminChat(p.userId, req.params.id)) {
          sendPushToUser(p.userId, {
            title: `Admin Chat - ${threadLabel}`,
            body: `${user.fullName}: ${messagePreview}`,
            url: "/admin",
            tag: `admin-chat-${req.params.id}`,
          });
        }
      }

      res.json({ ...msg, senderName: user.fullName });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/chat/threads/:id", requireMasterAdmin, async (req, res) => {
    try {
      await storage.deleteAdminChatThread(req.params.id);
      res.json({ message: "Thread deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/private-messages/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadPrivateMessageCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/private-messages/:id", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesByUser(req.session.userId!);
      const msg = messages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      await storage.deletePrivateMessage(req.params.id);
      res.json({ message: "Message deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/private-messages/:id/read", requireAuth, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesByUser(req.session.userId!);
      const msg = messages.find(m => m.id === req.params.id);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      const updated = await storage.markPrivateMessageRead(req.params.id);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Ticket notification routes
  app.get("/api/ticket-notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadTicketNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/ticket-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      await storage.markTicketNotificationsRead(req.session.userId!);
      res.json({ message: "Notifications marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/content-notifications/counts", requireAuth, async (req, res) => {
    try {
      const counts = await storage.getUnreadContentNotificationCounts(req.session.userId!);
      res.json(counts);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/content-notifications/unread-references/:category", requireAuth, async (req, res) => {
    try {
      const referenceIds = await storage.getUnreadContentNotificationReferenceIds(req.session.userId!, req.params.category);
      res.json(referenceIds);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/content-notifications/mark-read", requireAuth, async (req, res) => {
    try {
      const { category } = req.body;
      if (!category) return res.status(400).json({ message: "Category is required" });
      await storage.markContentNotificationsRead(req.session.userId!, category);
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/push/unsubscribe", requireAuth, async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (endpoint) {
        await storage.deletePushSubscription(endpoint);
      }
      res.json({ message: "Unsubscribed" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/push/vapid-key", (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
  });

  // WebSocket
  app.get("/api/admin/activity-logs", requirePermission("logs.view"), async (req, res) => {
    try {
      const { category, action, search, page, limit } = req.query;
      const result = await storage.getActivityLogs({
        category: category as string | undefined,
        action: action as string | undefined,
        search: search as string | undefined,
        page: page ? parseInt(page as string) : 1,
        limit: limit ? parseInt(limit as string) : 50,
      });
      const allUsers = await storage.getAllUsers();
      const userMap = new Map(allUsers.map(u => [u.id, u.fullName]));
      const enrichedLogs = result.logs.map(log => ({
        ...log,
        actorName: log.actorId ? userMap.get(log.actorId) || null : null,
        recipientName: log.recipientId ? userMap.get(log.recipientId) || null : null,
      }));
      res.json({ logs: enrichedLogs, total: result.total });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/activity-logs/:id", requirePermission("logs.view"), async (req, res) => {
    try {
      const log = await storage.getActivityLog(req.params.id);
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
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/downloads", requireAuth, async (_req, res) => {
    try {
      const result = await storage.getAllDownloads();
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/downloads", requirePermission("downloads.view", "downloads.manage"), upload.single("image"), async (req, res) => {
    try {
      const parsed = insertDownloadSchema.omit({ imageUrl: true }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors.map(e => e.message).join(", ") });
      }
      const imageUrl = req.file ? await saveUploadedFile(req.file) : null;
      const dl = await storage.createDownload({ ...parsed.data, imageUrl });
      res.json(dl);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/downloads/:id", requirePermission("downloads.view", "downloads.manage"), upload.single("image"), async (req, res) => {
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
      const dl = await storage.updateDownload(req.params.id, updateData);
      if (!dl) return res.status(404).json({ message: "Download not found" });
      res.json(dl);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/downloads/:id", requirePermission("downloads.view", "downloads.manage"), async (req, res) => {
    try {
      const existing = await storage.getDownload(req.params.id);
      if (!existing) return res.status(404).json({ message: "Download not found" });
      await storage.deleteDownload(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  storage.deleteExpiredUserNotifications(30).then(count => {
    if (count > 0) console.log(`[Cleanup] Deleted ${count} expired notification(s) older than 30 days`);
  }).catch(e => console.error("[Cleanup] Failed to delete expired notifications:", e.message));

  app.get("/api/notifications", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const notifications = await storage.getUserNotifications(req.session.userId!, limit, offset);
      res.json(notifications);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
    try {
      const count = await storage.getUnreadUserNotificationCount(req.session.userId!);
      res.json({ count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  async function clearRelatedBadge(userId: string, notif: { type: string; referenceType: string | null; referenceId: string | null }) {
    try {
      if (notif.type === "ticket_update" && notif.referenceId) {
        await storage.deleteTicketNotificationsByTicket(notif.referenceId);
      } else if (notif.type === "message" && notif.referenceId) {
        await storage.markThreadMessagesRead(notif.referenceId, userId);
      } else if (notif.type === "report_update") {
        await storage.markReportNotificationsRead(userId);
      } else if (notif.type === "alert" || notif.type === "news" || notif.type === "service_update") {
        const categoryMap: Record<string, string> = { alert: "alerts", news: "news", service_update: "service-updates" };
        const cat = categoryMap[notif.type];
        if (cat) await storage.markContentNotificationsRead(userId, cat);
      } else if (notif.type === "service_status") {
        await storage.markContentNotificationsRead(userId, "services");
      }
    } catch (e: any) {
      console.error("[NotifBadge] Failed to clear related badge:", e.message);
    }
  }

  app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
    try {
      const notifications = await storage.getUserNotifications(req.session.userId!, 100, 0);
      const notif = notifications.find(n => n.id === req.params.id);
      await storage.markUserNotificationRead(req.params.id, req.session.userId!);
      if (notif) await clearRelatedBadge(req.session.userId!, notif);
      res.json({ message: "Marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/notifications/:id/dismiss", requireAuth, async (req, res) => {
    try {
      const notifications = await storage.getUserNotifications(req.session.userId!, 100, 0);
      const notif = notifications.find(n => n.id === req.params.id);
      await storage.dismissUserNotification(req.params.id, req.session.userId!);
      if (notif) await clearRelatedBadge(req.session.userId!, notif);
      res.json({ message: "Dismissed" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/notifications/cleanup", requireMasterAdmin, async (req, res) => {
    try {
      const count = await storage.deleteExpiredUserNotifications(30);
      res.json({ deleted: count });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
    try {
      await storage.markAllUserNotificationsRead(req.session.userId!);
      res.json({ message: "All marked as read" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  wsSessionUserMap = new Map<WebSocket, string>();

  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") { socket.destroy(); return; }
    const fakeRes = Object.create(ServerResponse.prototype);
    sessionMiddleware(req as unknown as Request, fakeRes as unknown as Response, () => {
      const sessionReq = req as unknown as Request;
      const userId = sessionReq.session?.userId;
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (userId) wsSessionUserMap.set(ws, userId);
        wss.emit("connection", ws, req);
      });
    });
  });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    const sessionUserId = wsSessionUserMap.get(ws);

    ws.on("message", (raw) => {
      try {
        const data = JSON.parse(raw.toString());
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
    });
  });

  (async () => {
    try {
      const allFiles = await db.select({ filename: uploadedFiles.filename }).from(uploadedFiles);
      const validPaths = new Set(allFiles.map(f => `/uploads/${f.filename}`));

      const allNews = await db.select().from(newsStories).where(isNotNull(newsStories.imageUrl));
      for (const story of allNews) {
        if (story.imageUrl && !validPaths.has(story.imageUrl)) {
          await db.update(newsStories).set({ imageUrl: null }).where(eq(newsStories.id, story.id));
        }
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
    const monitor = await storage.getUrlMonitor(req.params.id);
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

  const ALLOWED_MONITOR_TYPES = ["http_status", "url_availability"];

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
    const monitor = await storage.getUrlMonitor(req.params.id);
    if (!monitor) return res.status(404).json({ message: "Monitor not found" });
    const parsed = monitorUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Invalid data", errors: parsed.error.flatten() });
    if (parsed.data.url) {
      const urlError = await validateMonitorUrlDns(parsed.data.url);
      if (urlError) return res.status(400).json({ message: urlError });
    }
    const updated = await storage.updateUrlMonitor(req.params.id, parsed.data);
    logActivity("monitoring", "monitor_updated", {
      actorId: req.session.userId,
      targetId: req.params.id,
      targetType: "url_monitor",
      summary: `Updated URL monitor: ${monitor.name}`,
    });
    res.json(updated);
  });

  app.delete("/api/admin/monitors/:id", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const monitor = await storage.getUrlMonitor(req.params.id);
    if (!monitor) return res.status(404).json({ message: "Monitor not found" });
    await storage.deleteUrlMonitor(req.params.id);
    logActivity("monitoring", "monitor_deleted", {
      actorId: req.session.userId,
      targetId: req.params.id,
      targetType: "url_monitor",
      summary: `Deleted URL monitor: ${monitor.name} (${monitor.url})`,
    });
    res.json({ message: "Deleted" });
  });

  app.get("/api/admin/monitors/:id/incidents", requirePermission("monitoring.view", "monitoring.manage"), async (req, res) => {
    const incidents = await storage.getMonitorIncidents(req.params.id);
    res.json(incidents);
  });

  async function notifyAdminsMonitorDown(monitor: { id: string; name: string; url: string; emailNotifications: boolean }, reason: string) {
    const allUsers = await storage.getAllUsers();
    const admins = allUsers.filter(u => u.role === "admin" || u.role === "master_admin");
    const failureTime = format(new Date(), "MMM d, yyyy h:mm a");

    for (const admin of admins) {
      sendPushToUser(admin.id, {
        title: `⚠️ ${monitor.name} is DOWN`,
        body: reason,
        url: "/admin",
        tag: `monitor-${monitor.id}-down`,
      });
    }

    if (monitor.emailNotifications) {
      const adminEmails = admins.filter(a => a.email).map(a => a.email!);
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
      sendPushToUser(admin.id, {
        title: `✅ ${monitor.name} is back UP`,
        body: `Recovered after ${downtimeDuration}`,
        url: "/admin",
        tag: `monitor-${monitor.id}-up`,
      });
    }

    if (monitor.emailNotifications) {
      const adminEmails = admins.filter(a => a.email).map(a => a.email!);
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
    } catch (err: any) {
      if (err.name === "AbortError") {
        failureReason = `Timeout after ${monitor.timeoutSeconds}s`;
      } else {
        failureReason = err.message || "Connection failed";
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

    if (newStatus === "up" && prevStatus === "down") {
      const openIncident = await storage.getOpenIncident(monitor.id);
      if (openIncident) {
        const downtimeSeconds = Math.round((now.getTime() - new Date(openIncident.startedAt).getTime()) / 1000);
        await notifyAdminsMonitorUp(monitor, downtimeSeconds);
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

  setTimeout(() => runMonitoringLoop(), 5000);
  setInterval(() => runMonitoringLoop(), 15000);

  return httpServer;
}
