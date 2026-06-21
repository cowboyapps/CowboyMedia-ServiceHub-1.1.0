import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, timestamp, integer, primaryKey, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
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
  onboardingTourCompletedAt: timestamp("onboarding_tour_completed_at"),
  totpSecret: text("totp_secret"),
  totpEnabledAt: timestamp("totp_enabled_at"),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  quietHoursEnabled: boolean("quiet_hours_enabled").notNull().default(false),
  quietHoursStart: text("quiet_hours_start").notNull().default("22:00"),
  quietHoursEnd: text("quiet_hours_end").notNull().default("07:00"),
  quietHoursTimezone: text("quiet_hours_timezone").notNull().default("UTC"),
  quietHoursAllowCritical: boolean("quiet_hours_allow_critical").notNull().default(true),
  lastVersionWelcomeSeen: text("last_version_welcome_seen"),
  servicesPickerDismissed: boolean("services_picker_dismissed").notNull().default(false),
  // WHMCS billing-platform link. Stores the WHMCS client id (integer) this
  // ServiceHub user maps to, plus when the link was established. Nullable —
  // most users are unlinked. The unique index relies on Postgres' default
  // NULLS DISTINCT so many unlinked users coexist while each WHMCS client id
  // links to at most one user. This is the cross-cutting contract downstream
  // billing features key their data off of.
  whmcsClientId: integer("whmcs_client_id"),
  whmcsLinkedAt: timestamp("whmcs_linked_at"),
  // When the customer dismissed the one-time "link your billing account"
  // prompt (either by linking successfully or choosing "not now"). Nullable —
  // null means the auto-popup is still eligible to fire. The Settings entry
  // point ignores this; it's available whenever the user is unlinked.
  whmcsLinkPromptDismissedAt: timestamp("whmcs_link_prompt_dismissed_at"),
  // When the customer dismissed the one-time v7 "Welcome to ServiceHub /
  // account linking" announcement popup. Null = still eligible to show.
  welcomeV7DismissedAt: timestamp("welcome_v7_dismissed_at"),
}, (table) => ({
  roleIdx: index("users_role_idx").on(table.role),
  whmcsClientIdx: uniqueIndex("users_whmcs_client_id_idx").on(table.whmcsClientId),
}));

export const totpBackupCodes = pgTable("totp_backup_codes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TotpBackupCode = typeof totpBackupCodes.$inferSelect;

export const services = pgTable("services", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("operational"),
  category: text("category"),
  discordWebhookUrl: text("discord_webhook_url"),
  isDefault: boolean("is_default").notNull().default(false),
});

export const serviceAlerts = pgTable("service_alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  severity: text("severity").notNull().default("warning"),
  status: text("status").notNull().default("investigating"),
  impact: text("impact"),
  imageUrl: text("image_url"),
  postmortemHtml: text("postmortem_html"),
  postmortemPublishedAt: timestamp("postmortem_published_at"),
  postmortemAuthorId: varchar("postmortem_author_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at"),
}, (table) => ({
  createdAtIdx: index("service_alerts_created_at_idx").on(table.createdAt.desc()),
}));

export const alertServices = pgTable("alert_services", {
  alertId: varchar("alert_id").notNull(),
  serviceId: varchar("service_id").notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.alertId, table.serviceId] }),
  serviceIdx: index("alert_services_service_id_idx").on(table.serviceId),
}));

export const alertUpdates = pgTable("alert_updates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  alertId: varchar("alert_id").notNull(),
  message: text("message").notNull(),
  status: text("status").notNull(),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  alertCreatedIdx: index("alert_updates_alert_id_created_at_idx").on(table.alertId, table.createdAt.desc()),
}));

export const newsStories = pgTable("news_stories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  authorId: varchar("author_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  createdAtIdx: index("news_stories_created_at_idx").on(table.createdAt.desc()),
}));

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
}, (table) => ({
  statusCreatedAtIdx: index("tickets_status_created_at_idx").on(table.status, table.createdAt.desc()),
  customerIdx: index("tickets_customer_id_idx").on(table.customerId),
  claimedByIdx: index("tickets_claimed_by_idx").on(table.claimedBy),
}));

export const ticketMessages = pgTable("ticket_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  ticketId: varchar("ticket_id").notNull(),
  senderId: varchar("sender_id").notNull(),
  message: text("message").notNull(),
  imageUrl: text("image_url"),
  readAt: timestamp("read_at"),
  isInternal: boolean("is_internal").notNull().default(false),
  // Optional KB article link attached to this message — stores the slug only.
  // The server resolves to a {slug,title,categoryName,summary} envelope at
  // read time so renamed/unpublished articles don't break old messages.
  kbArticleSlug: text("kb_article_slug"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  ticketCreatedIdx: index("ticket_messages_ticket_id_created_at_idx").on(table.ticketId, table.createdAt),
}));

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
}, (table) => ({
  unreadUserIdx: index("ticket_notifications_user_id_unread_idx").on(table.userId).where(sql`${table.readAt} IS NULL`),
}));

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("push_subscriptions_user_id_idx").on(table.userId),
}));

export const quickResponseCategories = pgTable("quick_response_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quickResponses = pgTable("quick_responses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  message: text("message").notNull(),
  categoryId: varchar("category_id"),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const quickResponseFavorites = pgTable("quick_response_favorites", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  adminId: varchar("admin_id").notNull(),
  responseId: varchar("response_id").notNull(),
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
}, (table) => ({
  unreadUserIdx: index("report_notifications_user_id_unread_idx").on(table.userId).where(sql`${table.readAt} IS NULL`),
}));

export const contentNotifications = pgTable("content_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  category: text("category").notNull(),
  referenceId: varchar("reference_id"),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userCategoryReadIdx: index("content_notifications_user_category_read_idx").on(table.userId, table.category, table.readAt),
}));

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

// Editable wording for WHMCS push / in-app notifications. Only the mutable
// fields live here; the label/description/group/variables/default copy are
// static and defined in shared/notification-templates.ts (the route merges
// them). `enabled` toggles whether the custom wording is used; when false the
// notifier falls back to the built-in default (the notification still sends).
export const notificationTemplates = pgTable("notification_templates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  templateKey: varchar("template_key").notNull().unique(),
  title: text("title").notNull(),
  body: text("body").notNull(),
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
}, (table) => ({
  threadCreatedIdx: index("admin_chat_messages_thread_id_created_at_idx").on(table.threadId, table.createdAt),
}));

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
export const updateProfileSchema = z.object({
  avatarUrl: z.string().max(500).nullable().optional(),
  bio: z.string().max(280).nullable().optional(),
});
export type UpdateProfile = z.infer<typeof updateProfileSchema>;
export const insertServiceSchema = createInsertSchema(services).omit({ id: true });
export const insertServiceAlertSchema = createInsertSchema(serviceAlerts).omit({ id: true, createdAt: true, resolvedAt: true });
export const insertAlertServiceSchema = createInsertSchema(alertServices);
export const insertAlertUpdateSchema = createInsertSchema(alertUpdates).omit({ id: true, createdAt: true });
export const insertNewsStorySchema = createInsertSchema(newsStories).omit({ id: true, createdAt: true });
export const insertTicketSchema = createInsertSchema(tickets).omit({ id: true, createdAt: true, closedAt: true });
export const insertTicketMessageSchema = createInsertSchema(ticketMessages).omit({ id: true, createdAt: true });
export const insertPrivateMessageSchema = createInsertSchema(privateMessages).omit({ id: true, createdAt: true, readAt: true });
export const insertTicketNotificationSchema = createInsertSchema(ticketNotifications).omit({ id: true, createdAt: true, readAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertQuickResponseSchema = createInsertSchema(quickResponses).omit({ id: true, createdAt: true, usageCount: true });
export const insertQuickResponseCategorySchema = createInsertSchema(quickResponseCategories).omit({ id: true, createdAt: true });
export const insertReportRequestSchema = createInsertSchema(reportRequests).omit({ id: true, createdAt: true });
export const insertReportNotificationSchema = createInsertSchema(reportNotifications).omit({ id: true, createdAt: true, readAt: true });
export const insertServiceUpdateSchema = createInsertSchema(serviceUpdates).omit({ id: true, createdAt: true });
export const insertEmailTemplateSchema = createInsertSchema(emailTemplates).omit({ id: true });
export const insertNotificationTemplateSchema = createInsertSchema(notificationTemplates).omit({ id: true });
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
export type ServiceAlertWithServices = ServiceAlert & { serviceIds: string[] };
export type InsertAlertService = z.infer<typeof insertAlertServiceSchema>;
export type AlertService = typeof alertServices.$inferSelect;
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
export type InsertQuickResponseCategory = z.infer<typeof insertQuickResponseCategorySchema>;
export type QuickResponseCategory = typeof quickResponseCategories.$inferSelect;
export type QuickResponseFavorite = typeof quickResponseFavorites.$inferSelect;
export type InsertReportRequest = z.infer<typeof insertReportRequestSchema>;
export type ReportRequest = typeof reportRequests.$inferSelect;
export type InsertReportNotification = z.infer<typeof insertReportNotificationSchema>;
export type ReportNotification = typeof reportNotifications.$inferSelect;
export type InsertServiceUpdate = z.infer<typeof insertServiceUpdateSchema>;
export type ServiceUpdate = typeof serviceUpdates.$inferSelect;
export type InsertEmailTemplate = z.infer<typeof insertEmailTemplateSchema>;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertNotificationTemplate = z.infer<typeof insertNotificationTemplateSchema>;
export type NotificationTemplate = typeof notificationTemplates.$inferSelect;
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

export const errorLogs = pgTable("error_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  severity: varchar("severity").notNull(),
  source: varchar("source").notNull(),
  summary: text("summary").notNull(),
  details: text("details"),
  userId: varchar("user_id"),
  referenceType: varchar("reference_type"),
  referenceId: varchar("reference_id"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: varchar("resolved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertErrorLogSchema = createInsertSchema(errorLogs).omit({ id: true, createdAt: true, resolvedAt: true, resolvedBy: true });
export type InsertErrorLog = z.infer<typeof insertErrorLogSchema>;
export type ErrorLog = typeof errorLogs.$inferSelect;

export const ERROR_LOG_SEVERITIES = ["warn", "error", "fatal"] as const;
export type ErrorLogSeverity = typeof ERROR_LOG_SEVERITIES[number];

export const ERROR_LOG_SOURCES = ["push", "email", "discord", "telegram", "whmcs", "webhook", "route", "job"] as const;
export type ErrorLogSource = typeof ERROR_LOG_SOURCES[number];

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

// Customer self-service WHMCS account-linking via emailed 6-digit code. A row
// is created when a logged-in user requests a code for an email that matched
// exactly one WHMCS client. The matched WHMCS client id is resolved
// SERVER-SIDE and stored here so verify never trusts client input — the code,
// emailed to the WHMCS-on-file address, is the ownership proof. Rows are
// single-use (consumedAt), short-lived (expiresAt), and attempt-capped.
export const whmcsLinkVerifications = pgTable("whmcs_link_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  whmcsClientId: integer("whmcs_client_id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  consumedAt: timestamp("consumed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("whmcs_link_verifications_user_id_idx").on(table.userId),
}));

export const insertWhmcsLinkVerificationSchema = createInsertSchema(whmcsLinkVerifications).omit({ id: true, createdAt: true });
export type InsertWhmcsLinkVerification = z.infer<typeof insertWhmcsLinkVerificationSchema>;
export type WhmcsLinkVerification = typeof whmcsLinkVerifications.$inferSelect;

export const urlMonitors = pgTable("url_monitors", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  url: text("url").notNull(),
  serviceId: varchar("service_id"),
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
}, (table) => ({
  monitorStartedIdx: index("monitor_incidents_monitor_id_started_at_idx").on(table.monitorId, table.startedAt.desc()),
}));

export const insertUrlMonitorSchema = createInsertSchema(urlMonitors).omit({ id: true, createdAt: true, lastCheckedAt: true, lastStatusChange: true, lastResponseTimeMs: true, consecutiveFailures: true, status: true });
export type InsertUrlMonitor = z.infer<typeof insertUrlMonitorSchema>;
export type UrlMonitor = typeof urlMonitors.$inferSelect;

export const insertMonitorIncidentSchema = createInsertSchema(monitorIncidents).omit({ id: true });
export type InsertMonitorIncident = z.infer<typeof insertMonitorIncidentSchema>;
export type MonitorIncident = typeof monitorIncidents.$inferSelect;

// Public status-page email subscribers (no login required).
export const serviceSubscribers = pgTable("service_subscribers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  serviceId: varchar("service_id").notNull(),
  email: text("email").notNull(),
  events: text("events").array().notNull().default(sql`'{}'::text[]`),
  unsubscribeToken: varchar("unsubscribe_token").notNull().unique(),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertServiceSubscriberSchema = createInsertSchema(serviceSubscribers).omit({ id: true, createdAt: true, confirmedAt: true });
export type InsertServiceSubscriber = z.infer<typeof insertServiceSubscriberSchema>;
export type ServiceSubscriber = typeof serviceSubscribers.$inferSelect;

export const SUBSCRIBER_EVENTS = ["status", "incident", "resolved"] as const;
export type SubscriberEvent = typeof SUBSCRIBER_EVENTS[number];

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
  imageUrl: text("image_url"),
  kbArticleSlug: text("kb_article_slug"),
  deliveredAt: timestamp("delivered_at"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  threadCreatedIdx: index("thread_messages_thread_id_created_at_idx").on(table.threadId, table.createdAt),
}));

export const insertMessageThreadSchema = createInsertSchema(messageThreads).omit({ id: true, lastMessageAt: true, createdAt: true });
export type InsertMessageThread = z.infer<typeof insertMessageThreadSchema>;
export type MessageThread = typeof messageThreads.$inferSelect;

export const insertThreadMessageSchema = createInsertSchema(threadMessages).omit({ id: true, deliveredAt: true, readAt: true, createdAt: true });
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
}, (table) => ({
  userCreatedIdx: index("user_notifications_user_id_created_at_idx").on(table.userId, table.createdAt.desc()),
  unreadUserIdx: index("user_notifications_user_id_unread_idx").on(table.userId).where(sql`${table.readAt} IS NULL AND ${table.dismissedAt} IS NULL`),
}));

export const insertUserNotificationSchema = createInsertSchema(userNotifications).omit({ id: true, readAt: true, dismissedAt: true, createdAt: true });
export type InsertUserNotification = z.infer<typeof insertUserNotificationSchema>;
export type UserNotification = typeof userNotifications.$inferSelect;

// Community chat
export const communityMessages = pgTable("community_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  chatUsername: text("chat_username").notNull(),
  content: text("content").notNull(),
  imageUrl: text("image_url"),
  kbArticleSlug: text("kb_article_slug"),
  pollId: varchar("poll_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const polls = pgTable("polls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parentType: text("parent_type").notNull(),
  parentId: varchar("parent_id").notNull(),
  question: text("question").notNull(),
  multiSelect: boolean("multi_select").notNull().default(false),
  closesAt: timestamp("closes_at"),
  createdBy: varchar("created_by").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const pollOptions = pgTable("poll_options", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  pollId: varchar("poll_id").notNull(),
  text: text("text").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const pollVotes = pgTable("poll_votes", {
  pollId: varchar("poll_id").notNull(),
  optionId: varchar("option_id").notNull(),
  userId: varchar("user_id").notNull(),
  isSingleChoice: boolean("is_single_choice").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.pollId, t.optionId, t.userId] }),
}));

export const POLL_PARENT_TYPES = ["news", "community"] as const;
export type PollParentType = typeof POLL_PARENT_TYPES[number];

export const insertPollSchema = z.object({
  parentType: z.enum(POLL_PARENT_TYPES),
  parentId: z.string().min(1).optional(),
  question: z.string().min(1, "Question is required").max(500),
  multiSelect: z.boolean().default(false),
  closesAt: z.string().datetime().nullable().optional(),
  options: z.array(z.string().trim().min(1, "Option text required").max(200)).min(2, "At least 2 options").max(6, "Up to 6 options"),
});
export type InsertPoll = z.infer<typeof insertPollSchema>;

export type Poll = typeof polls.$inferSelect;
export type PollOption = typeof pollOptions.$inferSelect;
export type PollVote = typeof pollVotes.$inferSelect;

export const voteSchema = z.object({
  optionIds: z.array(z.string().min(1)).max(6),
});
export type VoteData = z.infer<typeof voteSchema>;

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

export const NEWS_REACTION_EMOJIS = ["👍", "❤️", "🎉", "🤔", "😄"] as const;
export type NewsReactionEmoji = typeof NEWS_REACTION_EMOJIS[number];

export const newsReactions = pgTable("news_reactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  storyId: varchar("story_id").notNull(),
  userId: varchar("user_id").notNull(),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertNewsReactionSchema = createInsertSchema(newsReactions).omit({ id: true, createdAt: true });
export type InsertNewsReaction = z.infer<typeof insertNewsReactionSchema>;
export type NewsReaction = typeof newsReactions.$inferSelect;

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

// Discord settings (singleton row)
export const discordSettings = pgTable("discord_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  webhookUrl: text("webhook_url"),
  enabled: boolean("enabled").notNull().default(false),
  sendAlerts: boolean("send_alerts").notNull().default(true),
  sendServiceUpdates: boolean("send_service_updates").notNull().default(true),
  sendNews: boolean("send_news").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type DiscordSettings = typeof discordSettings.$inferSelect;

// WHMCS billing-platform connection settings (singleton row). Holds only
// non-secret config: the base URL of the WHMCS install (admin-editable in the
// portal), the master enable toggle, and whether to auto-match customers to
// WHMCS clients by email. The API identifier + secret live ONLY in env secrets
// (WHMCS_API_IDENTIFIER / WHMCS_API_SECRET), never in the DB — mirrors the
// Telegram split (token=env, chatId=DB).
export const whmcsSettings = pgTable("whmcs_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  baseUrl: text("base_url"),
  enabled: boolean("enabled").notNull().default(false),
  autoMatchByEmail: boolean("auto_match_by_email").notNull().default(true),
  // WHMCS admin username used to attribute staff replies posted from ServiceHub
  // back to WHMCS support tickets (AddTicketReply needs an admin username to
  // post a reply AS staff rather than as the client). Non-secret config, so it
  // lives in the DB like the base URL. Optional: when unset, staff replies to
  // WHMCS tickets are disabled (customer replies still work via clientid).
  adminUsername: text("admin_username"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type WhmcsSettings = typeof whmcsSettings.$inferSelect;

export const updateWhmcsSettingsSchema = z.object({
  baseUrl: z.union([z.string().trim().url("Must be a valid URL"), z.literal("")]).nullable().optional(),
  enabled: z.boolean().optional(),
  autoMatchByEmail: z.boolean().optional(),
  adminUsername: z.union([z.string().trim(), z.literal("")]).nullable().optional(),
});

export type UpdateWhmcsSettingsData = z.infer<typeof updateWhmcsSettingsSchema>;

// Customer-editable WHMCS contact profile (Task #371). Mirrors the server-side
// EDITABLE_PROFILE_FIELDS whitelist in server/whmcs.ts — these are the ONLY
// fields a linked customer may update on their own WHMCS client. The client id
// is NEVER part of this payload: the route derives it from the session user.
// All fields optional so the form can send only what changed; email must look
// like an email when present (WHMCS rejects a malformed one anyway, but we fail
// fast with a friendly inline message).
export const updateWhmcsProfileSchema = z.object({
  firstName: z.string().trim().max(255).optional(),
  lastName: z.string().trim().max(255).optional(),
  companyName: z.string().trim().max(255).optional(),
  email: z.string().trim().email("Must be a valid email").max(255).optional(),
  address1: z.string().trim().max(255).optional(),
  address2: z.string().trim().max(255).optional(),
  city: z.string().trim().max(255).optional(),
  state: z.string().trim().max(255).optional(),
  postcode: z.string().trim().max(64).optional(),
  country: z.string().trim().length(2, "Use a 2-letter country code").toUpperCase().optional(),
  phoneNumber: z.string().trim().max(64).optional(),
});

export type UpdateWhmcsProfileData = z.infer<typeof updateWhmcsProfileSchema>;

// Customer-initiated service cancellation request (Task #401). The target
// service id is NEVER part of this payload — it comes from the route path and is
// ownership-checked against the session user's linked WHMCS client server-side.
// `type` maps directly to the two timing options WHMCS's AddCancelRequest
// accepts; `reason` is an optional free-text note the customer can add.
export const requestServiceCancellationSchema = z.object({
  type: z.enum(["Immediate", "End of Billing Period"]),
  reason: z.string().trim().max(1000).optional(),
});

export type RequestServiceCancellationData = z.infer<typeof requestServiceCancellationSchema>;

// Customer in-app ordering (Task #453). The billing cycle is constrained to the
// recurring set WHMCS supports for ordering/upgrades (one-time/free are out of
// scope). `pid` / `newProductId` are positive WHMCS product ids; ownership and
// product/cycle validity are checked server-side against the live catalogue.
export const orderBillingCycleEnum = z.enum([
  "monthly",
  "quarterly",
  "semiannually",
  "annually",
  "biennially",
  "triennially",
]);

export const placeOrderSchema = z.object({
  pid: z.coerce.number().int().positive(),
  billingCycle: orderBillingCycleEnum,
});

export type PlaceOrderData = z.infer<typeof placeOrderSchema>;

export const submitUpgradeSchema = z.object({
  newProductId: z.coerce.number().int().positive(),
  billingCycle: orderBillingCycleEnum,
});

export type SubmitUpgradeData = z.infer<typeof submitUpgradeSchema>;

// Customer storefront order (Task #518). Like `placeOrderSchema` but also carries
// the product's configurable options + custom field answers. Config option values
// are WHMCS option ids (for dropdown/radio) or quantities (for quantity options),
// keyed by the WHMCS configurable-option id. Custom field answers are free text
// (or a chosen dropdown value), keyed by the WHMCS custom-field id. Both keys are
// the numeric WHMCS ids as strings; the server re-validates every value against
// the live catalogue before placing the order.
// Storefront orders (Task #518) additionally allow non-recurring products:
// WHMCS one-time and free products bill as a single charge, not a recurring
// cycle. The service/upgrade flows stay recurring-only (orderBillingCycleEnum);
// only the storefront accepts these extra keys, and the server still validates
// the chosen cycle against the product's live offered cycles.
export const storeBillingCycleEnum = z.enum([
  "monthly",
  "quarterly",
  "semiannually",
  "annually",
  "biennially",
  "triennially",
  "onetime",
  "free",
]);

export const placeProductOrderSchema = z.object({
  pid: z.coerce.number().int().positive(),
  billingCycle: storeBillingCycleEnum,
  configOptions: z.record(z.string().regex(/^\d+$/), z.coerce.number().int().nonnegative()).optional(),
  customFields: z.record(z.string().regex(/^\d+$/), z.string().max(2000)).optional(),
});

export type PlaceProductOrderData = z.infer<typeof placeProductOrderSchema>;

// Admin service module actions (Task #454). Staff-only suspend/unsuspend/
// terminate against a customer's live WHMCS service. The action is taken from
// the route path; this schema validates only the optional suspend reason.
export const ADMIN_SERVICE_ACTIONS = ["suspend", "unsuspend", "terminate"] as const;
export type AdminServiceAction = (typeof ADMIN_SERVICE_ACTIONS)[number];

export const adminSuspendServiceSchema = z.object({
  reason: z.string().trim().max(255).optional(),
});

export type AdminSuspendServiceData = z.infer<typeof adminSuspendServiceSchema>;

// Maps a WHMCS product/package (keyed by its `pid`) to one or more ServiceHub
// monitored services (Task #335). Many-to-many: a single product can cover
// several services and a service can be covered by several products. The unique
// index on (whmcs_product_id, service_id) makes each pairing idempotent, and
// the FK cascade drops a mapping row automatically when its service is deleted
// so no orphan derivations survive. WHMCS product ids are NOT FK-checked (they
// live in WHMCS, not here) — a mapping for a deleted WHMCS product simply never
// matches any active product and is harmless.
export const whmcsProductMappings = pgTable("whmcs_product_mappings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  whmcsProductId: integer("whmcs_product_id").notNull(),
  serviceId: varchar("service_id").notNull().references(() => services.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  pidServiceUniq: uniqueIndex("whmcs_product_mappings_pid_service_uniq").on(table.whmcsProductId, table.serviceId),
  serviceIdx: index("whmcs_product_mappings_service_id_idx").on(table.serviceId),
}));

export const insertWhmcsProductMappingSchema = createInsertSchema(whmcsProductMappings).omit({
  id: true,
  createdAt: true,
});

export type WhmcsProductMapping = typeof whmcsProductMappings.$inferSelect;
export type InsertWhmcsProductMapping = z.infer<typeof insertWhmcsProductMappingSchema>;

// Admin-curated WHMCS product storefront (Task #518). Each row enriches ONE
// WHMCS product (keyed uniquely by its pid) with display metadata so admins can
// present a polished "Order new product" catalogue to customers without exposing
// the raw WHMCS product list. This is INDEPENDENT of `whmcs_product_mappings`
// (which gates the service/upgrade picker): a product appears in the customer
// storefront only when it has an ENABLED row here AND still exists in the live
// WHMCS catalogue with at least one orderable cycle. `name`/`description` are
// optional overrides (fall back to the live WHMCS name/description when null);
// `imageUrl` points at an `uploaded_files` blob (`/uploads/<uuid>`); `category`
// groups products in the picker; `sortOrder` orders within a category. The pid
// is NOT FK-checked (it lives in WHMCS) — a row for a deleted WHMCS product
// simply never matches the live catalogue and is harmless.
export const storeProducts = pgTable("store_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  whmcsProductId: integer("whmcs_product_id").notNull().unique(),
  name: text("name"),
  description: text("description"),
  imageUrl: text("image_url"),
  category: text("category"),
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertStoreProductSchema = createInsertSchema(storeProducts).omit({
  id: true,
  createdAt: true,
});

export type StoreProduct = typeof storeProducts.$inferSelect;
export type InsertStoreProduct = z.infer<typeof insertStoreProductSchema>;

// Per-WHMCS-product DNS (connection address) set by admins (Task #473). Keyed
// uniquely by the WHMCS product id (pid) — the DNS is a property of the product
// TYPE, so every customer holding that product sees the same address and a
// brand-new signup can show it immediately. WHMCS product ids are NOT FK-checked
// (they live in WHMCS, not here); a row for a deleted WHMCS product simply never
// matches an active product and is harmless. The DNS is ServiceHub-stored only —
// never synced to/from WHMCS — and is surfaced to customers alongside their
// service login in "My Services".
export const whmcsProductDns = pgTable("whmcs_product_dns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  whmcsProductId: integer("whmcs_product_id").notNull().unique(),
  dns: text("dns").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertWhmcsProductDnsSchema = createInsertSchema(whmcsProductDns).omit({
  id: true,
  updatedAt: true,
});

export type WhmcsProductDns = typeof whmcsProductDns.$inferSelect;
export type InsertWhmcsProductDns = z.infer<typeof insertWhmcsProductDnsSchema>;

// Per-(user, WHMCS ticket) marker recording the last staff-reply date we have
// already notified the customer about (Task #344). WHMCS tickets are never
// stored (read-on-demand), so this is the ONLY server-side state for the
// "staff replied to your billing ticket" push/email — the background poller
// reads it to de-duplicate, so the same reply never notifies twice across
// poll passes or app restarts. `lastNotifiedReply` is a YYYY-MM-DD date string
// to match WHMCS list-payload day granularity (see shared/whmcs-unread.ts).
export const whmcsTicketNotifications = pgTable("whmcs_ticket_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  whmcsTicketId: integer("whmcs_ticket_id").notNull(),
  lastNotifiedReply: text("last_notified_reply").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userTicketUniq: uniqueIndex("whmcs_ticket_notifications_user_ticket_uniq").on(table.userId, table.whmcsTicketId),
}));

export type WhmcsTicketNotification = typeof whmcsTicketNotifications.$inferSelect;

// Per-(user, WHMCS invoice) marker for the "your invoice is due soon / overdue"
// push notifier. Like the ticket-reply marker above, it de-dupes reminders
// across poll passes and restarts. `lastNotifiedStage` is the ordered reminder
// stage we last told the customer about ("due_soon" | "overdue") — an invoice
// escalates at most once per stage (see shared/whmcs-invoice-notify.ts).
export const whmcsInvoiceNotifications = pgTable("whmcs_invoice_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  whmcsInvoiceId: integer("whmcs_invoice_id").notNull(),
  lastNotifiedStage: text("last_notified_stage").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userInvoiceUniq: uniqueIndex("whmcs_invoice_notifications_user_invoice_uniq").on(table.userId, table.whmcsInvoiceId),
}));

export type WhmcsInvoiceNotification = typeof whmcsInvoiceNotifications.$inferSelect;

// Per-(user, WHMCS service) marker for the service-lifecycle notifier
// (renewal-approaching / suspended / unsuspended). Two dedup fields live side by
// side because the events differ: `lastSeenStatus` drives suspend/unsuspend
// transition dedup (fire on the edge only), while `lastRenewalNotified` is the
// nextDueDate of the last renewal reminder (null = none) so renewal re-fires
// once per billing cycle when the date advances (see shared/whmcs-service-notify.ts).
export const whmcsServiceNotifications = pgTable("whmcs_service_notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  whmcsServiceId: integer("whmcs_service_id").notNull(),
  lastSeenStatus: text("last_seen_status").notNull(),
  lastRenewalNotified: text("last_renewal_notified"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userServiceUniq: uniqueIndex("whmcs_service_notifications_user_service_uniq").on(table.userId, table.whmcsServiceId),
}));

export type WhmcsServiceNotification = typeof whmcsServiceNotifications.$inferSelect;

// Records a customer's just-placed WHMCS order so the service notifier can later
// recognise the resulting service as NEWLY provisioned and fire the one-time
// "your new service is now ready" message (Task #474). WHMCS provisioning is
// asynchronous — the service id isn't known at order time — so we store the
// WHMCS product id (pid) the customer ordered plus (when known) the invoice id,
// then match by pid when a brand-new active service first appears for that user.
// `fulfilledAt` is stamped the moment the ready message fires, so it never
// repeats across poll passes or restarts (the fulfilled flag is the ultimate
// dedup). NO credentials are ever stored here.
export const whmcsPendingOrders = pgTable("whmcs_pending_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  whmcsProductId: integer("whmcs_product_id").notNull(),
  whmcsInvoiceId: integer("whmcs_invoice_id"),
  fulfilledAt: timestamp("fulfilled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("whmcs_pending_orders_user_id_idx").on(table.userId),
}));

export const insertWhmcsPendingOrderSchema = createInsertSchema(whmcsPendingOrders).omit({
  id: true,
  fulfilledAt: true,
  createdAt: true,
});

export type WhmcsPendingOrder = typeof whmcsPendingOrders.$inferSelect;
export type InsertWhmcsPendingOrder = z.infer<typeof insertWhmcsPendingOrderSchema>;

// App-level operational settings (singleton row). Holds the kill-switch for
// the GitHub→VPS auto-deploy webhook so a master_admin can pause production
// deploys from the UI during a maintenance window without touching the VPS.
export const appSettings = pgTable("app_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  autoDeployEnabled: boolean("auto_deploy_enabled").notNull().default(true),
  autoDeployPausedReason: text("auto_deploy_paused_reason"),
  autoDeployPausedBy: varchar("auto_deploy_paused_by"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppSettings = typeof appSettings.$inferSelect;

// Admin-editable release notes. One row per APP_VERSION. Created as a
// "draft" by the boot-time auto-draft hook the moment a new version
// goes live, then a master_admin writes notes in the admin portal and
// flips status to "published" — which is the gate that makes the
// "Welcome to version X" popup start firing for customers.
//
// Editing a row after publish does NOT bump publishedAt and does NOT
// re-fire the popup for users who already dismissed that version.
export const changelogEntries = pgTable("changelog_entries", {
  version: varchar("version").primaryKey(),
  title: text("title").notNull().default(""),
  bodyHtml: text("body_html").notNull().default(""),
  status: text("status").notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  // Set on publish to the master_admin user.id who flipped the switch.
  // ON DELETE SET NULL keeps the changelog row intact when an admin account
  // is later deleted — we don't want history to disappear with the user.
  publishedBy: varchar("published_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertChangelogEntrySchema = createInsertSchema(changelogEntries).omit({
  createdAt: true,
  updatedAt: true,
});

export type ChangelogEntry = typeof changelogEntries.$inferSelect;
export type InsertChangelogEntry = z.infer<typeof insertChangelogEntrySchema>;

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

export const supportAwayMessages = pgTable("support_away_messages", {
  id: varchar("id").primaryKey().default("singleton"),
  enabled: boolean("enabled").notNull().default(false),
  startAt: timestamp("start_at", { withTimezone: true }),
  endAt: timestamp("end_at", { withTimezone: true }),
  message: text("message").notNull().default(
    "Our support team is away right now. We'll be back shortly and will reply to your ticket as soon as we return."
  ),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: varchar("updated_by"),
});

export type SupportAwayMessage = typeof supportAwayMessages.$inferSelect;

export const updateSupportAwaySchema = z.object({
  enabled: z.boolean().optional(),
  startAt: z.string().datetime({ offset: true }).nullable().optional(),
  endAt: z.string().datetime({ offset: true }).nullable().optional(),
  message: z.string().trim().min(1, "Away message can't be empty").max(2000).optional(),
});

export type UpdateSupportAwayData = z.infer<typeof updateSupportAwaySchema>;

export const updateQuietHoursSchema = z.object({
  enabled: z.boolean().optional(),
  start: z.string().regex(HHMM_RE, "Use HH:MM 24-hour format").optional(),
  end: z.string().regex(HHMM_RE, "Use HH:MM 24-hour format").optional(),
  timezone: z.string().min(1).max(64).optional(),
  allowCritical: z.boolean().optional(),
});

export type UpdateQuietHoursData = z.infer<typeof updateQuietHoursSchema>;

// Telegram settings (admin PATCH)
export const updateTelegramSettingsSchema = z.object({
  chatId: z.union([z.string().max(128), z.null()]).optional(),
  enabled: z.boolean().optional(),
  sendAlerts: z.boolean().optional(),
  sendServiceUpdates: z.boolean().optional(),
  sendNews: z.boolean().optional(),
});
export type UpdateTelegramSettingsData = z.infer<typeof updateTelegramSettingsSchema>;

// Discord settings (admin PATCH)
const DISCORD_WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//i;
export const updateDiscordSettingsSchema = z.object({
  webhookUrl: z
    .union([
      z.literal(""),
      z.null(),
      z
        .string()
        .max(512)
        .refine((s) => s.trim() === "" || DISCORD_WEBHOOK_RE.test(s.trim()), {
          message: "Webhook URL must start with https://discord.com/api/webhooks/",
        }),
    ])
    .optional(),
  enabled: z.boolean().optional(),
  sendAlerts: z.boolean().optional(),
  sendServiceUpdates: z.boolean().optional(),
  sendNews: z.boolean().optional(),
});
export type UpdateDiscordSettingsData = z.infer<typeof updateDiscordSettingsSchema>;

// Ticket category metadata (admin PATCH)
export const updateTicketCategorySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.union([z.string().max(2000), z.null()]).optional(),
  assignedRoleIds: z.array(z.string().min(1).max(64)).max(64).optional(),
});
export type UpdateTicketCategoryData = z.infer<typeof updateTicketCategorySchema>;

export const createTicketCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.union([z.string().max(2000), z.null()]).optional(),
  assignedRoleIds: z.array(z.string().min(1).max(64)).max(64).optional(),
});
export type CreateTicketCategoryData = z.infer<typeof createTicketCategorySchema>;

export const ADMIN_PERMISSION_KEYS = [
  "users.view", "users.manage",
  "services.view", "services.manage",
  "alerts.view", "alerts.manage",
  "news.view", "news.manage",
  "messages.view", "messages.manage",
  "quick_responses.view", "quick_responses.manage",
  "service_updates.view", "service_updates.manage",
  "reports.view", "reports.manage",
  "email_templates.view", "email_templates.manage",
  "notification_templates.view", "notification_templates.manage",
  "downloads.view", "downloads.manage",
  "support_tickets",
  "admin_chat",
  "logs.view",
  "monitoring.view", "monitoring.manage",
  "announcements",
  "knowledge_base",
  "dashboard.view",
  "error_log.view",
] as const;
export type AdminPermissionKey = typeof ADMIN_PERMISSION_KEYS[number];

const adminPermissionKeySchema = z.enum(ADMIN_PERMISSION_KEYS as unknown as [string, ...string[]]);

export const createAdminRoleSchema = z.object({
  name: z.string().trim().min(1).max(120),
  permissions: z.array(adminPermissionKeySchema).max(ADMIN_PERMISSION_KEYS.length).optional(),
});
export type CreateAdminRoleData = z.infer<typeof createAdminRoleSchema>;

export const updateAdminRoleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  permissions: z.array(adminPermissionKeySchema).max(ADMIN_PERMISSION_KEYS.length).optional(),
});
export type UpdateAdminRoleData = z.infer<typeof updateAdminRoleSchema>;

export const publicStatusSubscribers = pgTable("public_status_subscribers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  unsubscribeToken: text("unsubscribe_token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type PublicStatusSubscriber = typeof publicStatusSubscribers.$inferSelect;

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

// Knowledge Base
export const kbCategories = pgTable("kb_categories", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const kbArticles = pgTable("kb_articles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  categoryId: varchar("category_id").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  summary: text("summary"),
  bodyHtml: text("body_html").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  published: boolean("published").notNull().default(true),
  viewCount: integer("view_count").notNull().default(0),
  helpfulCount: integer("helpful_count").notNull().default(0),
  unhelpfulCount: integer("unhelpful_count").notNull().default(0),
  sortOrder: integer("sort_order").notNull().default(0),
  authorId: varchar("author_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  categoryIdx: index("kb_articles_category_id_idx").on(table.categoryId),
}));

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const insertKbCategorySchema = createInsertSchema(kbCategories).omit({
  id: true,
  createdAt: true,
}).extend({
  slug: z.string().min(1).max(120).regex(SLUG_RE, "Lowercase letters, numbers, and single hyphens only"),
  name: z.string().min(1, "Name is required").max(120),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export type InsertKbCategory = z.infer<typeof insertKbCategorySchema>;
export type KbCategory = typeof kbCategories.$inferSelect;
export const updateKbCategorySchema = insertKbCategorySchema.partial();
export type UpdateKbCategory = z.infer<typeof updateKbCategorySchema>;

export const insertKbArticleSchema = createInsertSchema(kbArticles).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  viewCount: true,
  helpfulCount: true,
  unhelpfulCount: true,
  authorId: true,
}).extend({
  slug: z.string().min(1).max(160).regex(SLUG_RE, "Lowercase letters, numbers, and single hyphens only"),
  title: z.string().min(1, "Title is required").max(200),
  summary: z.string().max(500).nullable().optional(),
  bodyHtml: z.string().min(1, "Body is required").refine(
    (val) => val.replace(/<[^>]*>/g, "").trim().length > 0,
    "Body is required"
  ),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
  published: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
  categoryId: z.string().min(1, "Category is required"),
});
export type InsertKbArticle = z.infer<typeof insertKbArticleSchema>;
export type KbArticle = typeof kbArticles.$inferSelect;
export const updateKbArticleSchema = insertKbArticleSchema.partial();
export type UpdateKbArticle = z.infer<typeof updateKbArticleSchema>;

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
