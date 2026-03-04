import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from "ws";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import { db } from "./db";
import { uploadedFiles, newsStories, tickets, ticketMessages, insertServiceUpdateSchema } from "@shared/schema";
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
): Promise<void> {
  const rendered = await renderTemplate(templateKey, variables);
  if (rendered && !rendered.enabled) return;
  const fallback = !rendered ? getDefaultTemplate(templateKey) : null;
  const tpl = rendered || fallback;
  if (!tpl) return;
  const subject = rendered ? tpl.subject : replaceVarsSimple(tpl.subject, variables);
  const body = rendered ? tpl.body : replaceVarsSimple(tpl.body, variables);
  if (Array.isArray(to)) {
    sendEmailToMultiple(to, subject, body).catch(() => {});
  } else {
    sendEmail(to, subject, body).catch(() => {});
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
const ticketViewerCounts = new Map<string, Map<string, number>>();
const adminChatViewerCounts = new Map<string, Map<string, number>>();
const wsUserMap = new Map<WebSocket, { userId: string; ticketId: string }>();
const wsAdminChatMap = new Map<WebSocket, { userId: string; threadId: string }>();

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

function addTicketViewer(ticketId: string, userId: string): void {
  if (!ticketViewerCounts.has(ticketId)) ticketViewerCounts.set(ticketId, new Map());
  const users = ticketViewerCounts.get(ticketId)!;
  users.set(userId, (users.get(userId) || 0) + 1);
}

function removeTicketViewer(ticketId: string, userId: string): void {
  const users = ticketViewerCounts.get(ticketId);
  if (!users) return;
  const count = (users.get(userId) || 0) - 1;
  if (count <= 0) { users.delete(userId); } else { users.set(userId, count); }
  if (users.size === 0) ticketViewerCounts.delete(ticketId);
}

function isUserViewingTicket(userId: string, ticketId: string): boolean {
  const users = ticketViewerCounts.get(ticketId);
  return users ? (users.get(userId) || 0) > 0 : false;
}

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

async function sendPushToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }) {
  try {
    const subs = await storage.getPushSubscriptionsByUser(userId);
    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload)
        );
      } catch (err: any) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await storage.deletePushSubscription(sub.endpoint);
        }
      }
    }
  } catch (e) {
    console.error("Push notification error:", e);
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

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  const PgStore = ConnectPgSimple(session);

  app.use(
    session({
      store: new PgStore({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || "servicehub-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    })
  );

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
      const { username, password, email, fullName } = req.body;
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(400).json({ message: "Username already taken" });
      }
      const hashed = await hashPassword(password);
      const user = await storage.createUser({ username, password: hashed, email, fullName, role: "customer", theme: "light" });
      req.session.userId = user.id;
      const { password: _, ...safe } = user;
      res.json(safe);

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
        });
      }
      const adminIds = admins.map(a => a.id);
      storage.createContentNotificationBulk(adminIds, "admin-users", `New signup: ${fullName} (${username})`, user.id).catch(() => {});
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
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

  app.patch("/api/auth/profile", requireAuth, async (req, res) => {
    try {
      const { subscribedServices, fullName, emailNotifications, setupReminderDismissed } = req.body;
      const updateData: any = {};
      if (subscribedServices !== undefined) updateData.subscribedServices = subscribedServices;
      if (fullName !== undefined) updateData.fullName = fullName;
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
          });
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
        });
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
          });
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
      const { status } = req.body;
      const data: any = { status };
      if (status === "closed") {
        data.closedAt = new Date();
      }
      const updated = await storage.updateTicket(req.params.id, data);
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      broadcast({ type: "ticket_updated", ticket: updated });

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
              customer_email: customer.email,
              ticket_subject: ticket.subject,
            });
          }
        }

        if (customer?.email && customer.emailNotifications !== false) {
          try {
            const allMessages = await storage.getTicketMessages(ticket.id);
            const senderIds = [...new Set(allMessages.map(m => m.senderId))];
            const senderMap = new Map<string, string>();
            await Promise.all(senderIds.map(async (id) => {
              const sender = await storage.getUser(id);
              if (sender) senderMap.set(id, sender.fullName);
            }));
            const conversationHtml = allMessages.map(m => {
              const name = escapeHtml(senderMap.get(m.senderId) || "Unknown");
              const time = format(new Date(m.createdAt), "MMM d, yyyy 'at' h:mm a");
              const msgText = escapeHtml(m.message || "").replace(/\n/g, "<br/>");
              return `<div style="margin-bottom:12px;padding:8px;border-left:3px solid #e5e7eb;">
<p style="margin:0;font-size:13px;"><strong>${name}</strong> <span style="color:#6b7280;font-size:12px;">${time}</span></p>
<p style="margin:4px 0 0 0;font-size:14px;">${msgText}</p>
${m.imageUrl ? `<p style="margin:4px 0 0 0;"><a href="${escapeHtml(m.imageUrl)}" style="color:#3b82f6;font-size:12px;">View Attachment</a></p>` : ""}
</div>`;
            }).join("");
            sendTemplatedEmail(customer.email, "ticket_transcript", {
              ticket_subject: escapeHtml(ticket.subject),
              ticket_description: escapeHtml(ticket.description),
              customer_name: customer.fullName,
              opened_date: format(new Date(ticket.createdAt), "MMM d, yyyy 'at' h:mm a"),
              closed_date: format(new Date(), "MMM d, yyyy 'at' h:mm a"),
              conversation: conversationHtml,
            });
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
      });
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
        });
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
        });
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
      broadcast({ type: "ticket_message", ticketId: req.params.id, message });
      if (isAdmin) {
        sendPushToUser(ticket.customerId, {
          title: "New Ticket Reply",
          body: `Reply on: ${ticket.subject}`,
          url: `/tickets/${ticket.id}`,
          tag: `ticket-${ticket.id}`,
        });
        storage.createTicketNotification({
          userId: ticket.customerId,
          ticketId: ticket.id,
          type: "ticket_reply",
          message: `New reply on: ${ticket.subject}`,
        });
        const customer = await storage.getUser(ticket.customerId);
        if (customer?.email && customer.emailNotifications !== false && !isUserViewingTicket(ticket.customerId, ticket.id)) {
          sendTemplatedEmail(customer.email, "customer_ticket_reply", {
            ticket_subject: ticket.subject,
            message: req.body.message,
            customer_name: customer.fullName,
          });
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
            sendTemplatedEmail(admin.email, "admin_ticket_reply", {
              customer_name: user.fullName,
              customer_username: user.username,
              ticket_subject: ticket.subject,
              message: req.body.message,
            });
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
      const { username, password, email, fullName, role } = req.body;
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
      const updated = await storage.updateUser(req.params.id, req.body);
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
          });
          if (u.email && u.emailNotifications !== false) {
            sendTemplatedEmail(u.email, "customer_service_status", {
              service_name: updated.name,
              service_status: updated.status,
              customer_name: u.fullName,
            });
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

  app.post("/api/admin/alerts", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      const { sendPush, sendEmail, serviceImpact, ...alertData } = req.body;
      const alert = await storage.createAlert(alertData);
      const impact = serviceImpact || "degraded";
      await storage.updateService(alert.serviceId, { status: impact });
      const service = await storage.getService(alert.serviceId);
      const serviceName = service?.name || "Service";
      const impactLabel = impact === "outage" ? "Outage" : impact === "maintenance" ? "Maintenance" : "Degraded Performance";
      broadcast({ type: "new_alert", alert });
      broadcast({ type: "service_updated", serviceId: alert.serviceId });
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.subscribedServices?.includes(alert.serviceId) && u.id !== req.session.userId);
      for (const u of subscribers) {
        if (sendPush !== false) {
          sendPushToUser(u.id, {
            title: `${serviceName}: ${impactLabel}`,
            body: alert.title,
            url: `/alerts/${alert.id}`,
            tag: `alert-${alert.id}`,
          });
        }
        if (sendEmail !== false && u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceName}: ${impactLabel}`,
            alert_description: `${alert.title}\n\n${alert.description}`,
            customer_name: u.fullName,
          });
        }
      }
      const subIds = subscribers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", `${serviceName}: ${impactLabel} — ${alert.title}`, alert.id).catch(() => {});
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/alerts/:id/updates", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      const { sendPush, sendEmail, serviceImpact, ...updateData } = req.body;
      const update = await storage.createAlertUpdate({
        alertId: req.params.id,
        message: updateData.message,
        status: updateData.status,
      });
      if (updateData.status === "resolved") {
        await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      } else {
        await storage.updateAlert(req.params.id, { status: updateData.status });
      }
      broadcast({ type: "alert_update", alertId: req.params.id, update });
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
        const impactLabels: Record<string, string> = { degraded: "Degraded", outage: "Outage", maintenance: "Maintenance" };
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
        for (const u of subscribers) {
          if (sendPush !== false) {
            sendPushToUser(u.id, {
              title: pushTitle,
              body: updateData.message,
              url: `/alerts/${req.params.id}`,
              tag: `alert-${req.params.id}`,
            });
          }
          if (sendEmail !== false && u.email && u.emailNotifications !== false) {
            sendTemplatedEmail(u.email, "customer_service_alert", {
              alert_title: emailTitle,
              alert_description: updateData.message,
              customer_name: u.fullName,
            });
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

  app.patch("/api/admin/alerts/:id/resolve", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      const updated = await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      await storage.createAlertUpdate({
        alertId: req.params.id,
        message: "Issue has been resolved.",
        status: "resolved",
      });
      await storage.updateService(updated.serviceId, { status: "operational" });
      broadcast({ type: "alert_resolved", alertId: req.params.id });
      broadcast({ type: "service_updated", serviceId: updated.serviceId });
      const service = await storage.getService(updated.serviceId);
      const serviceName = service?.name || "Service";
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.subscribedServices?.includes(updated.serviceId) && u.id !== req.session.userId);
      for (const u of subscribers) {
        sendPushToUser(u.id, {
          title: `${serviceName}: Resolved — Now Operational`,
          body: `${updated.title} has been resolved. Service is back to operational.`,
          url: `/alerts/${req.params.id}`,
          tag: `alert-${req.params.id}`,
        });
        if (u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceName}: Issue Resolved — Service Restored`,
            alert_description: `${updated.title} has been resolved. Service is back to operational.`,
            customer_name: u.fullName,
          });
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
      await storage.deleteAlert(req.params.id);
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
      broadcast({ type: "new_service_update", update });

      const allUsers = await storage.getAllUsers();
      const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(serviceId));
      for (const u of subscribedCustomers) {
        sendPushToUser(u.id, {
          title: `Service Update: ${serviceName}`,
          body: title,
          url: "/service-updates",
          tag: `service-update-${update.id}`,
        });
        if (u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_update", {
            service_name: serviceName,
            update_title: title,
            update_description: description,
            customer_name: u.fullName,
          });
        }
      }
      const subIds = subscribedCustomers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "service-updates", title, update.id).catch(() => {});
      res.json(update);
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
      broadcast({ type: "new_news", story });
      const allUsers = await storage.getAllUsers();
      for (const u of allUsers.filter(u => u.role === "customer")) {
        sendPushToUser(u.id, {
          title: "New News Story",
          body: story.title,
          url: `/news/${story.id}`,
          tag: `news-${story.id}`,
        });
      }
      const customerEmails = allUsers.filter(u => u.role === "customer" && u.email && u.emailNotifications !== false).map(u => u.email);
      if (customerEmails.length > 0) {
        sendTemplatedEmail(customerEmails, "customer_news", {
          story_title: story.title,
          story_content: story.content,
        });
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
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/news/:id", requirePermission("news.view", "news.manage"), async (req, res) => {
    try {
      await storage.deleteNewsStory(req.params.id);
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
        });
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
        });
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
          });
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
        });

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
          });
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
      await storage.deleteReportRequest(req.params.id);
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
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  wss.on("connection", (ws) => {
    wsClients.add(ws);

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
        if (data.type === "viewing_ticket" && data.ticketId && data.userId) {
          const prev = wsUserMap.get(ws);
          if (prev) {
            removeTicketViewer(prev.ticketId, prev.userId);
          }
          wsUserMap.set(ws, { userId: data.userId, ticketId: data.ticketId });
          addTicketViewer(data.ticketId, data.userId);
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

  return httpServer;
}
