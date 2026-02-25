import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from "ws";
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";
import { pool } from "./db";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { promisify } from "util";
import webpush from "web-push";
import { sendEmail, sendEmailToMultiple } from "./email";

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

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${crypto.randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

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

  app.use("/uploads", requireAuth, (req, res, next) => {
    const filePath = path.join(uploadsDir, path.basename(req.path));
    res.sendFile(filePath, (err) => {
      if (err) res.status(404).json({ message: "File not found" });
    });
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
      const { subscribedServices, fullName } = req.body;
      const updateData: any = {};
      if (subscribedServices !== undefined) updateData.subscribedServices = subscribedServices;
      if (fullName !== undefined) updateData.fullName = fullName;
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
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
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
          sendEmail(admin.email, `New Support Ticket: ${ticket.subject}`,
            `<h2>New Support Ticket</h2>
<p><strong>Customer:</strong> ${customer.fullName} (@${customer.username})</p>
<p><strong>Email:</strong> ${customer.email}</p>
<p><strong>Service:</strong> ${service?.name || 'N/A'}</p>
<p><strong>Subject:</strong> ${ticket.subject}</p>
<p><strong>Priority:</strong> ${ticket.priority}</p>
<p><strong>Description:</strong></p>
<p>${ticket.description}</p>`
          );
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
        if (customer?.email) {
          sendEmail(customer.email, `Support Ticket Received: ${ticket.subject}`,
            `<h2>Support Ticket Received</h2>
<p>${autoReplyText}</p>
<p><strong>Ticket:</strong> ${ticket.subject}</p>`
          );
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
            sendEmail(admin.email, `Ticket Closed: ${ticket.subject}`,
              `<h2>Ticket Closed</h2>
<p><strong>Customer:</strong> ${customer.fullName} (@${customer.username})</p>
<p><strong>Email:</strong> ${customer.email}</p>
<p><strong>Subject:</strong> ${ticket.subject}</p>
<p>This ticket has been closed.</p>`
            );
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
      if (customer?.email) {
        sendEmail(customer.email, `Your Ticket Has Been Claimed: ${ticket.subject}`,
          `<h2>Your Support Ticket Has Been Claimed</h2>
<p><strong>${admin.fullName}</strong> has claimed your ticket and will be assisting you.</p>
<p><strong>Ticket:</strong> ${ticket.subject}</p>`
        );
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
    const senderMap = new Map<string, string>();
    await Promise.all(senderIds.map(async (id) => {
      const sender = await storage.getUser(id);
      if (sender) senderMap.set(id, sender.fullName);
    }));
    const enriched = messages.map(m => ({
      ...m,
      senderName: senderMap.get(m.senderId) || "Unknown",
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
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
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
        if (customer?.email) {
          sendEmail(customer.email, `New Reply to Your Support Ticket: ${ticket.subject}`,
            `<h2>New Reply to Your Support Ticket</h2>
<p>There is a new reply to your ticket: <strong>${ticket.subject}</strong></p>
<p><strong>Reply:</strong></p>
<p>${req.body.message}</p>
<p>If your issue has been resolved, you can close the ticket in the app. If not, please reply back.</p>`
          );
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
            sendEmail(admin.email, `New Ticket Message: ${ticket.subject}`,
              `<h2>New Ticket Message</h2>
<p><strong>From:</strong> ${user.fullName} (@${user.username})</p>
<p><strong>Ticket:</strong> ${ticket.subject}</p>
<p><strong>Message:</strong></p>
<p>${req.body.message}</p>`
            );
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
        for (const u of subscribedCustomers) {
          sendPushToUser(u.id, {
            title: "Service Status Update",
            body: `${updated.name}: ${updated.status}`,
            url: "/services",
            tag: `service-${updated.id}`,
          });
          if (u.email) {
            sendEmail(u.email, `Service Status Update: ${updated.name}`,
              `<h2>Service Status Update</h2><p>The service <strong>${updated.name}</strong> status has changed to <strong>${updated.status}</strong>.</p>`
            );
          }
        }
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
        if (u.email) {
          sendEmail(u.email, `New Service Alert: ${alert.title}`,
            `<h2>New Service Alert</h2><p><strong>${alert.title}</strong></p><p>${alert.description}</p>`
          );
        }
      }
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

  app.post("/api/admin/news", requireAdmin, upload.single("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? `/uploads/${req.file.filename}` : undefined;
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
      const customerEmails = allUsers.filter(u => u.role === "customer" && u.email).map(u => u.email);
      if (customerEmails.length > 0) {
        sendEmailToMultiple(customerEmails, `News: ${story.title}`,
          `<h2>${story.title}</h2><p>${story.content}</p>`
        );
      }
      res.json(story);
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

      if (recipient.email && sender) {
        sendEmail(recipient.email, `Private Message from ${sender.username}`,
          `<h2>New Private Message</h2>
<p>You have received a private message from <strong>${sender.fullName} (@${sender.username})</strong>.</p>
<p><strong>Subject:</strong> ${subject}</p>
<p><strong>Message:</strong></p>
<p>${body}</p>
<p>Log in to ServiceHub to view and manage your messages.</p>`
        );
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

  return httpServer;
}
