import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("customer"),
  subscribedServices: text("subscribed_services").array().default(sql`'{}'::text[]`),
  theme: text("theme").notNull().default("light"),
});

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("operational"),
  category: text("category"),
});

export const serviceAlerts = pgTable("service_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("warning"),
  status: text("status").notNull().default("investigating"),
  serviceId: varchar("service_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const alertUpdates = pgTable("alert_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  alertId: varchar("alert_id").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const newsStories = pgTable("news_stories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  authorId: varchar("author_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const tickets = pgTable("tickets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  serviceId: varchar("service_id"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  customerId: varchar("customer_id").notNull(),
  claimedBy: varchar("claimed_by"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  message: text("message").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const privateMessages = pgTable("private_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  recipientId: varchar("recipient_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ticketNotifications = pgTable("ticket_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  ticketId: varchar("ticket_id").notNull(),
  type: text("type").notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quickResponses = pgTable("quick_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reportRequests = pgTable("report_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  customerId: varchar("customer_id").notNull(),
  type: text("type").notNull(),
  serviceId: varchar("service_id"),
  title: text("title").notNull(),
  description: text("description"),
  status: text("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const reportNotifications = pgTable("report_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  reportRequestId: varchar("report_request_id").notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const uploadedFiles = pgTable("uploaded_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull().unique(),
  mimetype: text("mimetype").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export const insertServiceAlertSchema = createInsertSchema(serviceAlerts).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertAlertUpdateSchema = createInsertSchema(alertUpdates).omit({ id: true, createdAt: true });
export const insertNewsStorySchema = createInsertSchema(newsStories).omit({ id: true, createdAt: true });
export const insertTicketSchema = createInsertSchema(tickets).omit({ id: true, createdAt: true, closedAt: true });
export const insertTicketMessageSchema = createInsertSchema(ticketMessages).omit({ id: true, createdAt: true });
export const insertPrivateMessageSchema = createInsertSchema(privateMessages).omit({ id: true, createdAt: true, readAt: true });
export const insertTicketNotificationSchema = createInsertSchema(ticketNotifications).omit({ id: true, createdAt: true, readAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertQuickResponseSchema = createInsertSchema(quickResponses).omit({ id: true, createdAt: true });
export const insertReportRequestSchema = createInsertSchema(reportRequests).omit({ id: true, createdAt: true });
export const insertReportNotificationSchema = createInsertSchema(reportNotifications).omit({ id: true, createdAt: true, readAt: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertService = z.infer<typeof insertServiceSchema>;
export type Service = typeof services.$inferSelect;
export type InsertServiceAlert = z.infer<typeof insertServiceAlertSchema>;
export type ServiceAlert = typeof serviceAlerts.$inferSelect;
export type InsertAlertUpdate = z.infer<typeof insertAlertUpdateSchema>;
export type AlertUpdate = typeof alertUpdates.$inferSelect;
export type InsertNewsStory = z.infer<typeof insertNewsStorySchema>;
export type NewsStory = typeof newsStories.$inferSelect;
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof tickets.$inferSelect;
export type InsertTicketMessage = z.infer<typeof insertTicketMessageSchema>;
export type TicketMessage = typeof ticketMessages.$inferSelect;
export type InsertPrivateMessage = z.infer<typeof insertPrivateMessageSchema>;
export type PrivateMessage = typeof privateMessages.$inferSelect;
export type InsertTicketNotification = z.infer<typeof insertTicketNotificationSchema>;
export type TicketNotification = typeof ticketNotifications.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertQuickResponse = z.infer<typeof insertQuickResponseSchema>;
export type QuickResponse = typeof quickResponses.$inferSelect;
export type InsertReportRequest = z.infer<typeof insertReportRequestSchema>;
export type ReportRequest = typeof reportRequests.$inferSelect;
export type InsertReportNotification = z.infer<typeof insertReportNotificationSchema>;
export type ReportNotification = typeof reportNotifications.$inferSelect;

// Login schema
export const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

export type LoginData = z.infer<typeof loginSchema>;

// Registration schema
export const registerSchema = z.object({
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  email: z.string().email("Invalid email address"),
  fullName: z.string().min(1, "Full name is required"),
});

export type RegisterData = z.infer<typeof registerSchema>;
