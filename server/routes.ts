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
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) {
      cb(null, true);
    } else {
      cb(new Error("Only image files are allowed"));
    }
  },
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
      const { subscribedServices } = req.body;
      const updated = await storage.updateUser(req.session.userId!, { subscribedServices });
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
    res.json(messages);
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
      const updated = await storage.updateService(req.params.id, req.body);
      if (!updated) return res.status(404).json({ message: "Service not found" });
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
