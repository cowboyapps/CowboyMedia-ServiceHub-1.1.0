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

const scryptAsync = promisify(crypto.scrypt);

async function sendTemplatedEmail(
  to: string | string[],
  templateKey: string,
  variables: Record<string, string>,
): Promise<void> {
  const rendered = await renderTemplate(templateKey, variables);
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
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
}

const wsClients = new Set<WebSocket>();

function broadcast(data: any) {
  const message = JSON.stringify(data);
  wsClients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
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
      const admins = allUsers.filter(u => u.role === "admin" && u.username !== "cowboymedia-support");
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
    if (user.role === "admin") {
      const result = await storage.getAllTickets();
      res.json(result);
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
    if (user.role !== "admin" && ticket.customerId !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
    }
    res.json(ticket);
  });

  app.post("/api/tickets", requireAuth, upload.single("image"), async (req, res) => {
    try {
      const { subject, description, serviceId, priority } = req.body;
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const ticket = await storage.createTicket({
        subject,
        description,
        serviceId: serviceId || null,
        priority: priority || "medium",
        customerId: req.session.userId!,
        status: "open",
        imageUrl: imageUrl || null,
      });
      broadcast({ type: "new_ticket", ticket });

      const customer = await storage.getUser(req.session.userId!);
      const service = ticket.serviceId ? await storage.getService(ticket.serviceId) : null;
      const allUsers = await storage.getAllUsers();
      const admins = allUsers.filter(u => u.role === "admin" && u.username !== "cowboymedia-support");
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
      if (user.role !== "admin" && ticket.customerId !== user.id) {
        return res.status(403).json({ message: "Forbidden" });
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
        const admins = allUsers.filter(u => u.role === "admin" && u.username !== "cowboymedia-support");
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
      }

      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/tickets/:id/claim", requireAdmin, async (req, res) => {
    try {
      const ticket = await storage.getTicket(req.params.id);
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      if (ticket.claimedBy) {
        const claimedAdmin = await storage.getUser(ticket.claimedBy);
        return res.status(400).json({ message: `Ticket already claimed by ${claimedAdmin?.fullName || "another admin"}` });
      }
      const admin = await storage.getUser(req.session.userId!);
      if (!admin) return res.status(401).json({ message: "Unauthorized" });

      const updated = await storage.updateTicket(req.params.id, { claimedBy: admin.id });
      if (!updated) return res.status(404).json({ message: "Ticket not found" });
      broadcast({ type: "ticket_updated", ticket: updated });

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
        const claimMessage = `${admin.fullName} has claimed this ticket and will be assisting you.`;
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

      sendPushToUser(ticket.customerId, {
        title: "Ticket Claimed",
        body: `${admin.fullName} is now handling your ticket: ${ticket.subject}`,
        url: `/tickets/${ticket.id}`,
        tag: `ticket-${ticket.id}`,
      });
      storage.createTicketNotification({
        userId: ticket.customerId,
        ticketId: ticket.id,
        type: "ticket_claimed",
        message: `${admin.fullName} claimed your ticket: ${ticket.subject}`,
      });

      const customer = await storage.getUser(ticket.customerId);
      if (customer?.email && customer.emailNotifications !== false) {
        sendTemplatedEmail(customer.email, "customer_ticket_claimed", {
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

  app.get("/api/tickets/:id/messages", requireAuth, async (req, res) => {
    const ticket = await storage.getTicket(req.params.id);
    if (!ticket) return res.status(404).json({ message: "Ticket not found" });
    const user = await storage.getUser(req.session.userId!);
    if (!user) return res.status(401).json({ message: "Unauthorized" });
    if (user.role !== "admin" && ticket.customerId !== user.id) {
      return res.status(403).json({ message: "Forbidden" });
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
      if (!user || user.role !== "admin") {
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
      if (user.role !== "admin" && ticket.customerId !== user.id) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "admin" && !ticket.claimedBy) {
        return res.status(400).json({ message: "You must claim this ticket before responding" });
      }
      if (user.role === "admin" && ticket.claimedBy !== user.id) {
        return res.status(403).json({ message: "Only the admin who claimed this ticket can respond" });
      }
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const message = await storage.createTicketMessage({
        ticketId: req.params.id,
        senderId: req.session.userId!,
        message: req.body.message,
        imageUrl: imageUrl || null,
      });
      broadcast({ type: "ticket_message", ticketId: req.params.id, message });
      if (user.role === "admin") {
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
        if (customer?.email && customer.emailNotifications !== false) {
          sendTemplatedEmail(customer.email, "customer_ticket_reply", {
            ticket_subject: ticket.subject,
            message: req.body.message,
            customer_name: customer.fullName,
          });
        }
      } else {
        const allAdminUsers = await storage.getAllUsers();
        const admins = allAdminUsers.filter(u => u.role === "admin" && u.username !== "cowboymedia-support");
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
          if (admin.email) {
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
  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const result = await storage.getAllUsers();
    const safe = result.map(({ password: _, ...u }) => u);
    res.json(safe);
  });

  app.get("/api/admin/users/push-status", requireAdmin, async (_req, res) => {
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

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
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

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateUser(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "User not found" });
      const { password: _, ...safe } = updated;
      res.json(safe);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/users/:id/password", requireAdmin, async (req, res) => {
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

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteUser(req.params.id);
      res.json({ message: "User deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/services", requireAdmin, async (req, res) => {
    try {
      const service = await storage.createService(req.body);
      res.json(service);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/services/:id", requireAdmin, async (req, res) => {
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

  app.delete("/api/admin/services/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteService(req.params.id);
      res.json({ message: "Service deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/alerts", requireAdmin, async (req, res) => {
    try {
      const alert = await storage.createAlert(req.body);
      broadcast({ type: "new_alert", alert });
      const allUsers = await storage.getAllUsers();
      const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(alert.serviceId));
      for (const u of subscribedCustomers) {
        sendPushToUser(u.id, {
          title: "New Service Alert",
          body: alert.title,
          url: `/alerts/${alert.id}`,
          tag: `alert-${alert.id}`,
        });
        if (u.email && u.emailNotifications !== false) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: alert.title,
            alert_description: alert.description,
            customer_name: u.fullName,
          });
        }
      }
      const subIds = subscribedCustomers.map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", alert.title, alert.id).catch(() => {});
      res.json(alert);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/alerts/:id/updates", requireAdmin, async (req, res) => {
    try {
      const update = await storage.createAlertUpdate({
        alertId: req.params.id,
        message: req.body.message,
        status: req.body.status,
      });
      if (req.body.status === "resolved") {
        await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      } else {
        await storage.updateAlert(req.params.id, { status: req.body.status });
      }
      broadcast({ type: "alert_update", alertId: req.params.id, update });
      const alert = await storage.getAlert(req.params.id);
      if (alert) {
        const allUsers = await storage.getAllUsers();
        const subscribedCustomers = allUsers.filter(u => u.role === "customer" && u.subscribedServices?.includes(alert.serviceId));
        for (const u of subscribedCustomers) {
          sendPushToUser(u.id, {
            title: `Alert Update: ${alert.title}`,
            body: req.body.message,
            url: `/alerts/${req.params.id}`,
            tag: `alert-${req.params.id}`,
          });
        }
        const subIds = subscribedCustomers.map(u => u.id);
        storage.createContentNotificationBulk(subIds, "alerts", `Update: ${alert.title}`, alert.id).catch(() => {});
      }
      res.json(update);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/alerts/:id/resolve", requireAdmin, async (req, res) => {
    try {
      const updated = await storage.updateAlert(req.params.id, { status: "resolved", resolvedAt: new Date() });
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      await storage.createAlertUpdate({
        alertId: req.params.id,
        message: "Issue has been resolved.",
        status: "resolved",
      });
      broadcast({ type: "alert_resolved", alertId: req.params.id });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/alerts/:id", requireAdmin, async (req, res) => {
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
      res.json(updates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/service-updates", requireAdmin, async (req, res) => {
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
      await storage.deleteServiceUpdate(req.params.id);
      res.json({ message: "Service update deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/news", requireAdmin, upload.single("image"), async (req, res) => {
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

  app.patch("/api/admin/news/:id", requireAdmin, upload.single("image"), async (req, res) => {
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

  app.delete("/api/admin/news/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteNewsStory(req.params.id);
      res.json({ message: "News story deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // Delete ticket route (admin only)
  app.delete("/api/admin/tickets/:id", requireAdmin, async (req, res) => {
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
  app.post("/api/admin/private-messages", requireAdmin, async (req, res) => {
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

  app.get("/api/admin/private-messages/sent", requireAdmin, async (req, res) => {
    try {
      const messages = await storage.getPrivateMessagesBySender(req.session.userId!);
      res.json(messages);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/private-messages/:id", requireAdmin, async (req, res) => {
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

  app.get("/api/admin/quick-responses", requireAdmin, async (req, res) => {
    try {
      const responses = await storage.getAllQuickResponses();
      res.json(responses);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/quick-responses", requireAdmin, async (req, res) => {
    try {
      const { title, message } = req.body;
      if (!title || !message) return res.status(400).json({ message: "Title and message are required" });
      const qr = await storage.createQuickResponse({ title, message });
      res.json(qr);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/quick-responses/:id", requireAdmin, async (req, res) => {
    try {
      const { title, message } = req.body;
      const updated = await storage.updateQuickResponse(req.params.id, { title, message });
      if (!updated) return res.status(404).json({ message: "Quick response not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/admin/quick-responses/:id", requireAdmin, async (req, res) => {
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
      if (user.role === "admin") {
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
      const admins = allUsers.filter(u => u.role === "admin" && u.username !== "cowboymedia-support");
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

  app.patch("/api/admin/report-requests/:id", requireAdmin, async (req, res) => {
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

  app.delete("/api/admin/report-requests/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteReportRequest(req.params.id);
      res.json({ message: "Deleted" });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/email-templates", requireAdmin, async (_req, res) => {
    try {
      const templates = await storage.getAllEmailTemplates();
      res.json(templates);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/admin/email-templates/:id", requireAdmin, async (req, res) => {
    try {
      const { subject, body } = req.body;
      const updateData: any = {};
      if (subject !== undefined) updateData.subject = subject;
      if (body !== undefined) updateData.body = body;
      const updated = await storage.updateEmailTemplate(req.params.id, updateData);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/admin/email-templates/:id/reset", requireAdmin, async (req, res) => {
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
    ws.on("close", () => {
      wsClients.delete(ws);
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
