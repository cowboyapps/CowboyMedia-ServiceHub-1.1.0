import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, integer, primaryKey, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import type { NotificationPrefs } from "./notification-categories";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("customer"),
  adminRoleId: varchar("admin_role_id"),
  subscribedServices: text("subscribed_services").array().default(sql`'{}'::text[]`),
  theme: text("theme").notNull().default("light"),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  notificationPrefs: jsonb("notification_prefs").$type<NotificationPrefs>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  setupReminderDismissed: boolean("setup_reminder_dismissed").default(false).notNull(),
  setupReminderEmailSent: boolean("setup_reminder_email_sent").default(false).notNull(),
  chatUsername: text("chat_username"),
  chatNotifications: text("chat_notifications").default("mentions"),
  chatBanned: boolean("chat_banned").default(false),
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
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
});

export const alertUpdates = pgTable("alert_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  alertId: varchar("alert_id").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  imageUrl: text("image_url"),
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
  categoryId: varchar("category_id"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("medium"),
  customerId: varchar("customer_id").notNull(),
  claimedBy: varchar("claimed_by"),
  imageUrl: text("image_url"),
  resolutionNote: text("resolution_note"),
  closedBy: varchar("closed_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  closedAt: timestamp("closed_at"),
});

export const ticketMessages = pgTable("ticket_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  message: text("message").notNull(),
  imageUrl: text("image_url"),
  readAt: timestamp("read_at"),
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
  imageUrl: text("image_url"),
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

export const contentNotifications = pgTable("content_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(),
  referenceId: varchar("reference_id"),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const serviceUpdates = pgTable("service_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  serviceId: varchar("service_id").notNull(),
  matureContent: boolean("mature_content").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const hiddenServiceUpdates = pgTable("hidden_service_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  serviceUpdateId: varchar("service_update_id").notNull(),
});

export const emailTemplates = pgTable("email_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: varchar("template_key").notNull().unique(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  availableVariables: text("available_variables").array().default(sql`'{}'::text[]`),
  description: text("description"),
  enabled: boolean("enabled").notNull().default(true),
  customized: boolean("customized").notNull().default(false),
});

export const uploadedFiles = pgTable("uploaded_files", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  filename: text("filename").notNull().unique(),
  mimetype: text("mimetype").notNull(),
  data: text("data").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminRoles = pgTable("admin_roles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  permissions: text("permissions").array().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ticketCategories = pgTable("ticket_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull().unique(),
  description: text("description"),
  assignedRoleIds: text("assigned_role_ids").array().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminChatThreads = pgTable("admin_chat_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const adminChatParticipants = pgTable("admin_chat_participants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  userId: varchar("user_id").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
  lastReadAt: timestamp("last_read_at"),
});

export const adminChatMessages = pgTable("admin_chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  message: text("message").notNull(),
  fileUrl: text("file_url"),
  fileType: text("file_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const broadcastMessages = pgTable("broadcast_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  senderId: varchar("sender_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const broadcastRecipients = pgTable("broadcast_recipients", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  broadcastId: varchar("broadcast_id").notNull(),
  recipientId: varchar("recipient_id").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const ticketTransfers = pgTable("ticket_transfers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull(),
  fromAdminId: varchar("from_admin_id").notNull(),
  toAdminId: varchar("to_admin_id").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, emailNotifications: true });
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
export const insertServiceUpdateSchema = createInsertSchema(serviceUpdates).omit({ id: true, createdAt: true });
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true });
export const insertAdminRoleSchema = createInsertSchema(adminRoles).omit({ id: true, createdAt: true });
export const insertTicketCategorySchema = createInsertSchema(ticketCategories).omit({ id: true, createdAt: true });
export const insertAdminChatThreadSchema = createInsertSchema(adminChatThreads).omit({ id: true, createdAt: true });
export const insertAdminChatParticipantSchema = createInsertSchema(adminChatParticipants).omit({ id: true, joinedAt: true });
export const insertAdminChatMessageSchema = createInsertSchema(adminChatMessages).omit({ id: true, createdAt: true });
export const insertBroadcastMessageSchema = createInsertSchema(broadcastMessages).omit({ id: true, createdAt: true });
export const insertBroadcastRecipientSchema = createInsertSchema(broadcastRecipients).omit({ id: true, createdAt: true, readAt: true });
export const insertTicketTransferSchema = createInsertSchema(ticketTransfers).omit({ id: true, createdAt: true });

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
export type InsertServiceUpdate = z.infer<typeof insertServiceUpdateSchema>;
export type ServiceUpdate = typeof serviceUpdates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertAdminRole = z.infer<typeof insertAdminRoleSchema>;
export type AdminRole = typeof adminRoles.$inferSelect;
export type InsertTicketCategory = z.infer<typeof insertTicketCategorySchema>;
export type TicketCategory = typeof ticketCategories.$inferSelect;
export type InsertAdminChatThread = z.infer<typeof insertAdminChatThreadSchema>;
export type AdminChatThread = typeof adminChatThreads.$inferSelect;
export type InsertAdminChatParticipant = z.infer<typeof insertAdminChatParticipantSchema>;
export type AdminChatParticipant = typeof adminChatParticipants.$inferSelect;
export type InsertAdminChatMessage = z.infer<typeof insertAdminChatMessageSchema>;
export type AdminChatMessage = typeof adminChatMessages.$inferSelect;
export type InsertBroadcastMessage = z.infer<typeof insertBroadcastMessageSchema>;
export type BroadcastMessage = typeof broadcastMessages.$inferSelect;
export type InsertBroadcastRecipient = z.infer<typeof insertBroadcastRecipientSchema>;
export type BroadcastRecipient = typeof broadcastRecipients.$inferSelect;
export type InsertTicketTransfer = z.infer<typeof insertTicketTransferSchema>;
export type TicketTransfer = typeof ticketTransfers.$inferSelect;

export const adminActivityLogs = pgTable("admin_activity_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  category: varchar("category").notNull(),
  action: varchar("action").notNull(),
  actorId: varchar("actor_id"),
  targetId: varchar("target_id"),
  targetType: varchar("target_type"),
  recipientId: varchar("recipient_id"),
  summary: text("summary").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAdminActivityLogSchema = createInsertSchema(adminActivityLogs).omit({ id: true, createdAt: true });
export type InsertAdminActivityLog = z.infer<typeof insertAdminActivityLogSchema>;
export type AdminActivityLog = typeof adminActivityLogs.$inferSelect;

export const downloads = pgTable("downloads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  downloaderCode: text("downloader_code").notNull(),
  downloadUrl: text("download_url").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDownloadSchema = createInsertSchema(downloads).omit({ id: true, createdAt: true });
export type InsertDownload = z.infer<typeof insertDownloadSchema>;
export type Download = typeof downloads.$inferSelect;

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPasswordResetTokenSchema = createInsertSchema(passwordResetTokens).omit({ id: true, createdAt: true });
export type InsertPasswordResetToken = z.infer<typeof insertPasswordResetTokenSchema>;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;

export const urlMonitors = pgTable("url_monitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  monitorType: text("monitor_type").notNull().default("url_availability"),
  checkIntervalSeconds: integer("check_interval_seconds").notNull().default(60),
  expectedStatusCode: integer("expected_status_code").notNull().default(200),
  timeoutSeconds: integer("timeout_seconds").notNull().default(10),
  consecutiveFailuresThreshold: integer("consecutive_failures_threshold").notNull().default(3),
  emailNotifications: boolean("email_notifications").notNull().default(true),
  enabled: boolean("enabled").notNull().default(true),
  status: text("status").notNull().default("unknown"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastStatusChange: timestamp("last_status_change"),
  lastResponseTimeMs: integer("last_response_time_ms"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const monitorIncidents = pgTable("monitor_incidents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  monitorId: varchar("monitor_id").notNull(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
  durationSeconds: integer("duration_seconds"),
  failureReason: text("failure_reason"),
  notifiedDown: boolean("notified_down").notNull().default(false),
  notifiedUp: boolean("notified_up").notNull().default(false),
});

export const insertUrlMonitorSchema = createInsertSchema(urlMonitors).omit({ id: true, createdAt: true, lastCheckedAt: true, lastStatusChange: true, lastResponseTimeMs: true, consecutiveFailures: true, status: true });
export type InsertUrlMonitor = z.infer<typeof insertUrlMonitorSchema>;
export type UrlMonitor = typeof urlMonitors.$inferSelect;

export const insertMonitorIncidentSchema = createInsertSchema(monitorIncidents).omit({ id: true });
export type InsertMonitorIncident = z.infer<typeof insertMonitorIncidentSchema>;
export type MonitorIncident = typeof monitorIncidents.$inferSelect;

// Message threads (conversational messaging)
export const messageThreads = pgTable("message_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(),
  customerId: varchar("customer_id").notNull(),
  subject: text("subject").notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const threadMessages = pgTable("thread_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  body: text("body").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMessageThreadSchema = createInsertSchema(messageThreads).omit({ id: true, lastMessageAt: true, createdAt: true });
export type InsertMessageThread = z.infer<typeof insertMessageThreadSchema>;
export type MessageThread = typeof messageThreads.$inferSelect;

export const insertThreadMessageSchema = createInsertSchema(threadMessages).omit({ id: true, readAt: true, createdAt: true });
export type InsertThreadMessage = z.infer<typeof insertThreadMessageSchema>;
export type ThreadMessage = typeof threadMessages.$inferSelect;

export const userNotifications = pgTable("user_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  referenceType: text("reference_type"),
  referenceId: varchar("reference_id"),
  url: text("url"),
  readAt: timestamp("read_at"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserNotificationSchema = createInsertSchema(userNotifications).omit({ id: true, readAt: true, dismissedAt: true, createdAt: true });
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;
export type UserNotification = typeof userNotifications.$inferSelect;

// Community chat
export const communityMessages = pgTable("community_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  chatUsername: text("chat_username").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const communityReactions = pgTable("community_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  messageId: varchar("message_id").notNull(),
  userId: varchar("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommunityMessageSchema = createInsertSchema(communityMessages).omit({ id: true, createdAt: true });
export type InsertCommunityMessage = z.infer<typeof insertCommunityMessageSchema>;
export type CommunityMessage = typeof communityMessages.$inferSelect;

export const insertCommunityReactionSchema = createInsertSchema(communityReactions).omit({ id: true, createdAt: true });
export type InsertCommunityReaction = z.infer<typeof insertCommunityReactionSchema>;
export type CommunityReaction = typeof communityReactions.$inferSelect;

// Chat word filters
export const chatWordFilters = pgTable("chat_word_filters", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  word: text("word").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatWordFilterSchema = createInsertSchema(chatWordFilters).omit({ id: true, createdAt: true });
export type InsertChatWordFilter = z.infer<typeof insertChatWordFilterSchema>;
export type ChatWordFilter = typeof chatWordFilters.$inferSelect;

// Telegram settings (singleton row)
export const telegramSettings = pgTable("telegram_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  chatId: text("chat_id"),
  enabled: boolean("enabled").notNull().default(false),
  sendAlerts: boolean("send_alerts").notNull().default(true),
  sendServiceUpdates: boolean("send_service_updates").notNull().default(true),
  sendNews: boolean("send_news").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type TelegramSettings = typeof telegramSettings.$inferSelect;

export const businessHours = pgTable("business_hours", {
  id: varchar("id").primaryKey().default("singleton"),
  enabled: boolean("enabled").notNull().default(false),
  daysOfWeek: integer("days_of_week").array().notNull().default(sql`'{1,2,3,4,5}'::integer[]`),
  startTime: text("start_time").notNull().default("09:00"),
  endTime: text("end_time").notNull().default("17:00"),
  timezone: text("timezone").notNull().default("America/New_York"),
  afterHoursMessage: text("after_hours_message").notNull().default(
    "Our support team is currently outside of business hours. You can still submit a ticket and we'll respond as soon as we're back."
  ),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type BusinessHours = typeof businessHours.$inferSelect;

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const updateBusinessHoursSchema = z.object({
  enabled: z.boolean().optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  startTime: z.string().regex(HHMM_RE, "Use HH:MM 24-hour format").optional(),
  endTime: z.string().regex(HHMM_RE, "Use HH:MM 24-hour format").optional(),
  timezone: z.string().min(1).max(64).optional(),
  afterHoursMessage: z.string().max(2000).optional(),
});

export type UpdateBusinessHoursData = z.infer<typeof updateBusinessHoursSchema>;

export const announcements = pgTable("announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  bodyHtml: text("body_html").notNull(),
  linkPath: text("link_path"),
  linkLabel: text("link_label"),
  frequency: text("frequency").notNull().default("once"),
  active: boolean("active").notNull().default(true),
  createdByUserId: varchar("created_by_user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const announcementDismissals = pgTable("announcement_dismissals", {
  announcementId: varchar("announcement_id").notNull(),
  userId: varchar("user_id").notNull(),
  dismissedAt: timestamp("dismissed_at").defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.announcementId, table.userId] }),
}));

export type Announcement = typeof announcements.$inferSelect;
export type AnnouncementDismissal = typeof announcementDismissals.$inferSelect;

export const insertAnnouncementSchema = createInsertSchema(announcements).omit({
  id: true,
  createdAt: true,
  createdByUserId: true,
}).extend({
  title: z.string().min(1, "Title is required").max(200),
  bodyHtml: z.string().min(1, "Body is required").refine(
    (val) => val.replace(/<[^>]*>/g, "").trim().length > 0,
    "Body is required"
  ),
  linkPath: z.string().nullable().optional(),
  linkLabel: z.string().max(60).nullable().optional(),
  frequency: z.enum(["once", "always"]).default("once"),
  active: z.boolean().default(true),
});

export type InsertAnnouncement = z.infer<typeof insertAnnouncementSchema>;

export const updateAnnouncementSchema = insertAnnouncementSchema.partial();
export type UpdateAnnouncement = z.infer<typeof updateAnnouncementSchema>;

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
