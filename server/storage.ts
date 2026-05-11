import {
  type User, type InsertUser,
  type Service, type InsertService,
  type ServiceAlert, type InsertServiceAlert,
  type AlertUpdate, type InsertAlertUpdate,
  type NewsStory, type InsertNewsStory,
  type Ticket, type InsertTicket,
  type TicketMessage, type InsertTicketMessage,
  type PrivateMessage, type InsertPrivateMessage,
  type TicketNotification, type InsertTicketNotification,
  type PushSubscription, type InsertPushSubscription,
  type QuickResponse, type InsertQuickResponse,
  type ReportRequest, type InsertReportRequest,
  type ReportNotification, type InsertReportNotification,
  type ServiceUpdate, type InsertServiceUpdate,
  type EmailTemplate,
  type AdminRole, type InsertAdminRole,
  type TicketCategory, type InsertTicketCategory,
  type AdminChatThread, type InsertAdminChatThread,
  type AdminChatParticipant, type InsertAdminChatParticipant,
  type AdminChatMessage, type InsertAdminChatMessage,
  type BroadcastMessage, type InsertBroadcastMessage,
  type BroadcastRecipient, type InsertBroadcastRecipient,
  type TicketTransfer, type InsertTicketTransfer,
  type AdminActivityLog, type InsertAdminActivityLog,
  type Download, type InsertDownload,
  type PasswordResetToken, type InsertPasswordResetToken,
  type UrlMonitor, type InsertUrlMonitor,
  type MonitorIncident, type InsertMonitorIncident,
  type MessageThread, type InsertMessageThread,
  type ThreadMessage, type InsertThreadMessage,
  type UserNotification, type InsertUserNotification,
  type CommunityMessage, type InsertCommunityMessage,
  type CommunityReaction, type InsertCommunityReaction,
  type ChatWordFilter,
  type TelegramSettings,
  discordSettings,
  type DiscordSettings,
  type BusinessHours,
  type UpdateBusinessHoursData,
  type Announcement,
  type InsertAnnouncement,
  type UpdateAnnouncement,
  type ServiceSubscriber,
  type InsertServiceSubscriber,
  type KbCategory, type InsertKbCategory, type UpdateKbCategory,
  type KbArticle, type InsertKbArticle, type UpdateKbArticle,
  type PublicStatusSubscriber,
  users, services, serviceAlerts, alertUpdates, newsStories, tickets, ticketMessages, privateMessages, ticketNotifications, pushSubscriptions, quickResponses, reportRequests, reportNotifications, contentNotifications, serviceUpdates, hiddenServiceUpdates, emailTemplates, adminRoles, ticketCategories, adminChatThreads, adminChatParticipants, adminChatMessages, broadcastMessages, broadcastRecipients, ticketTransfers, adminActivityLogs, downloads, passwordResetTokens, urlMonitors, monitorIncidents, messageThreads, threadMessages, userNotifications, communityMessages, communityReactions, chatWordFilters, telegramSettings, businessHours, announcements, announcementDismissals, serviceSubscribers, kbCategories, kbArticles, publicStatusSubscribers,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull, isNotNull, sql, inArray, gte, ne } from "drizzle-orm";

export type DashboardMetrics = {
  generatedAt: string;
  tickets: {
    open: number;
    awaitingCustomer: number;
    awaitingAdmin: number;
    openedToday: number;
    resolvedToday: number;
    avgFirstResponseMinutes7d: number | null;
    series14d: { date: string; opened: number; resolved: number }[];
  };
  services: {
    total: number;
    operational: number;
    degraded: number;
    down: number;
    activeAlerts: number;
    recentAlerts: { id: string; title: string; severity: string; status: string; createdAt: string }[];
  };
  notifications: {
    pushSent24h: number;
    emailSent24h: number;
    pushSubscriptionsTotal: number;
    pushSubscriptionsThisWeek: number;
  };
  knowledgeBase: {
    total: number;
    published: number;
    topViewed: { id: string; title: string; slug: string; viewCount: number }[];
  };
  community: {
    messages24h: number;
    activeUsers7d: number;
    bannedUsers: number;
  };
  users: {
    total: number;
    customers: number;
    admins: number;
    signupsToday: number;
    signupsThisWeek: number;
  };
};

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getAllServices(): Promise<Service[]>;
  getService(id: string): Promise<Service | undefined>;
  createService(service: InsertService): Promise<Service>;
  updateService(id: string, data: Partial<Service>): Promise<Service | undefined>;
  deleteService(id: string): Promise<void>;

  getAllAlerts(): Promise<ServiceAlert[]>;
  getAlert(id: string): Promise<ServiceAlert | undefined>;
  createAlert(alert: InsertServiceAlert): Promise<ServiceAlert>;
  updateAlert(id: string, data: Partial<ServiceAlert>): Promise<ServiceAlert | undefined>;
  deleteAlert(id: string): Promise<void>;

  getAlertUpdates(alertId: string): Promise<AlertUpdate[]>;
  createAlertUpdate(update: InsertAlertUpdate): Promise<AlertUpdate>;
  updateAlertUpdate(id: string, data: Partial<{ message: string; imageUrl: string | null }>): Promise<AlertUpdate | undefined>;
  getAlertNotificationRecipientIds(alertId: string): Promise<string[]>;
  getPublicStatusSubscribers(): Promise<PublicStatusSubscriber[]>;
  getPublicStatusSubscriberByEmail(email: string): Promise<PublicStatusSubscriber | undefined>;
  getPublicStatusSubscriberByToken(token: string): Promise<PublicStatusSubscriber | undefined>;
  createPublicStatusSubscriber(email: string, unsubscribeToken: string): Promise<PublicStatusSubscriber>;
  deletePublicStatusSubscriberByToken(token: string): Promise<boolean>;

  getAllNews(): Promise<NewsStory[]>;
  getNewsStory(id: string): Promise<NewsStory | undefined>;
  createNewsStory(story: InsertNewsStory): Promise<NewsStory>;
  updateNewsStory(id: string, data: Partial<InsertNewsStory>): Promise<NewsStory | undefined>;
  deleteNewsStory(id: string): Promise<void>;

  getAllTickets(): Promise<Ticket[]>;
  getTicketsByCustomer(customerId: string): Promise<Ticket[]>;
  getTicket(id: string): Promise<Ticket | undefined>;
  createTicket(ticket: InsertTicket): Promise<Ticket>;
  updateTicket(id: string, data: Partial<Ticket>): Promise<Ticket | undefined>;

  deleteTicket(id: string): Promise<void>;

  getTicketMessages(ticketId: string): Promise<TicketMessage[]>;
  createTicketMessage(message: InsertTicketMessage): Promise<TicketMessage>;
  markTicketMessagesRead(ticketId: string, readerId: string): Promise<void>;

  createPrivateMessage(message: InsertPrivateMessage): Promise<PrivateMessage>;
  getPrivateMessagesByUser(userId: string): Promise<PrivateMessage[]>;
  getPrivateMessagesBySender(senderId: string): Promise<PrivateMessage[]>;
  getUnreadPrivateMessageCount(userId: string): Promise<number>;
  markPrivateMessageRead(id: string): Promise<PrivateMessage | undefined>;
  deletePrivateMessage(id: string): Promise<void>;

  createTicketNotification(notification: InsertTicketNotification): Promise<TicketNotification>;
  getUnreadTicketNotificationCount(userId: string): Promise<number>;
  getTicketNotificationsByUser(userId: string): Promise<TicketNotification[]>;
  markTicketNotificationsRead(userId: string): Promise<void>;
  deleteTicketNotificationsByTicket(ticketId: string): Promise<void>;

  getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;
  createPushSubscription(sub: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  getPushSubscriptionByEndpoint(endpoint: string): Promise<PushSubscription | undefined>;

  getAllQuickResponses(): Promise<QuickResponse[]>;
  getQuickResponse(id: string): Promise<QuickResponse | undefined>;
  createQuickResponse(qr: InsertQuickResponse): Promise<QuickResponse>;
  updateQuickResponse(id: string, data: Partial<QuickResponse>): Promise<QuickResponse | undefined>;
  deleteQuickResponse(id: string): Promise<void>;

  getAllReportRequests(): Promise<ReportRequest[]>;
  getReportRequestsByCustomer(customerId: string): Promise<ReportRequest[]>;
  createReportRequest(rr: InsertReportRequest): Promise<ReportRequest>;
  updateReportRequest(id: string, data: Partial<ReportRequest>): Promise<ReportRequest | undefined>;
  deleteReportRequest(id: string): Promise<void>;

  createReportNotification(notification: InsertReportNotification): Promise<ReportNotification>;
  getUnreadReportNotificationCount(userId: string): Promise<number>;
  markReportNotificationsRead(userId: string): Promise<void>;

  createContentNotification(userId: string, category: string, message: string, referenceId?: string): Promise<void>;
  createContentNotificationBulk(userIds: string[], category: string, message: string, referenceId?: string): Promise<void>;
  getUnreadContentNotificationCounts(userId: string): Promise<Record<string, number>>;
  getUnreadContentNotificationReferenceIds(userId: string, category: string): Promise<string[]>;
  markContentNotificationsRead(userId: string, category: string): Promise<void>;

  getAllServiceUpdates(): Promise<ServiceUpdate[]>;
  createServiceUpdate(update: InsertServiceUpdate): Promise<ServiceUpdate>;
  updateServiceUpdate(id: string, data: Partial<{ title: string; description: string; matureContent: boolean }>): Promise<ServiceUpdate | undefined>;
  deleteServiceUpdate(id: string): Promise<void>;
  hideServiceUpdate(userId: string, serviceUpdateId: string): Promise<void>;
  getHiddenServiceUpdateIds(userId: string): Promise<string[]>;

  getAllEmailTemplates(): Promise<EmailTemplate[]>;
  getEmailTemplateByKey(key: string): Promise<EmailTemplate | undefined>;
  updateEmailTemplate(id: string, data: Partial<EmailTemplate>): Promise<EmailTemplate | undefined>;
  upsertEmailTemplate(data: { templateKey: string; name: string; subject: string; body: string; availableVariables: string[]; description: string }): Promise<void>;

  getAllAdminRoles(): Promise<AdminRole[]>;
  getAdminRole(id: string): Promise<AdminRole | undefined>;
  createAdminRole(role: InsertAdminRole): Promise<AdminRole>;
  updateAdminRole(id: string, data: Partial<AdminRole>): Promise<AdminRole | undefined>;
  deleteAdminRole(id: string): Promise<void>;

  getAllTicketCategories(): Promise<TicketCategory[]>;
  getTicketCategory(id: string): Promise<TicketCategory | undefined>;
  createTicketCategory(cat: InsertTicketCategory): Promise<TicketCategory>;
  updateTicketCategory(id: string, data: Partial<TicketCategory>): Promise<TicketCategory | undefined>;
  deleteTicketCategory(id: string): Promise<void>;

  createAdminChatThread(thread: InsertAdminChatThread): Promise<AdminChatThread>;
  getAdminChatThreadsForUser(userId: string): Promise<AdminChatThread[]>;
  getAdminChatThread(id: string): Promise<AdminChatThread | undefined>;
  deleteAdminChatThread(id: string): Promise<void>;
  getAdminChatMessages(threadId: string): Promise<AdminChatMessage[]>;
  createAdminChatMessage(msg: InsertAdminChatMessage): Promise<AdminChatMessage>;
  addAdminChatParticipant(participant: InsertAdminChatParticipant): Promise<AdminChatParticipant>;
  getAdminChatParticipants(threadId: string): Promise<AdminChatParticipant[]>;
  markAdminChatThreadRead(threadId: string, userId: string): Promise<void>;
  getAdminChatUnreadCounts(userId: string): Promise<number>;
  getAdminChatUnreadThreadIds(userId: string): Promise<string[]>;

  createBroadcastMessage(data: InsertBroadcastMessage, recipientIds: string[]): Promise<BroadcastMessage>;
  getUnreadBroadcasts(userId: string): Promise<BroadcastMessage[]>;
  markBroadcastRead(broadcastId: string, userId: string): Promise<void>;

  createTicketTransfer(data: InsertTicketTransfer): Promise<TicketTransfer>;
  getPendingTransfersForAdmin(adminId: string): Promise<TicketTransfer[]>;
  getPendingTransferByTicketId(ticketId: string): Promise<TicketTransfer | undefined>;
  updateTicketTransfer(id: string, data: Partial<TicketTransfer>): Promise<TicketTransfer | undefined>;

  getAllDownloads(): Promise<Download[]>;
  getDownload(id: string): Promise<Download | undefined>;
  createDownload(data: InsertDownload): Promise<Download>;
  updateDownload(id: string, data: Partial<Download>): Promise<Download | undefined>;
  deleteDownload(id: string): Promise<void>;

  createActivityLog(data: InsertAdminActivityLog): Promise<AdminActivityLog>;
  getActivityLogs(filters: { category?: string; action?: string; search?: string; page?: number; limit?: number }): Promise<{ logs: AdminActivityLog[]; total: number }>;
  getActivityLog(id: string): Promise<AdminActivityLog | undefined>;

  getUserByEmail(email: string): Promise<User | undefined>;
  createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken>;
  getPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | undefined>;
  markPasswordResetTokenUsed(id: string): Promise<void>;

  getAllUrlMonitors(): Promise<UrlMonitor[]>;
  getUrlMonitor(id: string): Promise<UrlMonitor | undefined>;
  createUrlMonitor(data: InsertUrlMonitor): Promise<UrlMonitor>;
  updateUrlMonitor(id: string, data: Partial<UrlMonitor>): Promise<UrlMonitor | undefined>;
  deleteUrlMonitor(id: string): Promise<void>;

  getMonitorIncidents(monitorId: string): Promise<MonitorIncident[]>;
  getOpenIncident(monitorId: string): Promise<MonitorIncident | undefined>;
  getOpenIncidents(monitorId: string): Promise<MonitorIncident[]>;
  createMonitorIncident(data: InsertMonitorIncident): Promise<MonitorIncident>;
  updateMonitorIncident(id: string, data: Partial<MonitorIncident>): Promise<MonitorIncident | undefined>;
  getMonitorsByService(serviceId: string): Promise<UrlMonitor[]>;

  createServiceSubscriber(data: InsertServiceSubscriber): Promise<ServiceSubscriber>;
  getServiceSubscriberByToken(token: string): Promise<ServiceSubscriber | undefined>;
  findServiceSubscriber(email: string, serviceId: string): Promise<ServiceSubscriber | undefined>;
  confirmServiceSubscriber(id: string): Promise<ServiceSubscriber | undefined>;
  deleteServiceSubscriber(id: string): Promise<void>;
  updateServiceSubscriberEvents(id: string, events: string[]): Promise<void>;
  getConfirmedSubscribersForService(serviceId: string): Promise<ServiceSubscriber[]>;

  createMessageThread(data: InsertMessageThread): Promise<MessageThread>;
  getMessageThread(id: string): Promise<MessageThread | undefined>;
  getMessageThreadsForUser(userId: string, role: string): Promise<MessageThread[]>;
  updateMessageThread(id: string, data: Partial<MessageThread>): Promise<MessageThread | undefined>;
  deleteMessageThread(id: string): Promise<void>;

  getThreadMessages(threadId: string): Promise<ThreadMessage[]>;
  createThreadMessage(data: InsertThreadMessage): Promise<ThreadMessage>;
  markThreadMessagesRead(threadId: string, userId: string): Promise<void>;
  getUnreadThreadMessageCount(userId: string): Promise<number>;

  createUserNotification(data: InsertUserNotification): Promise<UserNotification>;
  getUserNotifications(userId: string, limit?: number, offset?: number): Promise<UserNotification[]>;
  getUnreadUserNotificationCount(userId: string): Promise<number>;
  getUserNotification(id: string, userId: string): Promise<UserNotification | undefined>;
  markUserNotificationRead(id: string, userId: string): Promise<void>;
  dismissUserNotification(id: string, userId: string): Promise<void>;
  markAllUserNotificationsRead(userId: string): Promise<void>;
  dismissAllUserNotifications(userId: string): Promise<void>;
  markUserNotificationsByTypeRead(userId: string, types: string[]): Promise<void>;
  deleteExpiredUserNotifications(daysOld: number): Promise<number>;

  getCommunityMessages(limit?: number, before?: string): Promise<CommunityMessage[]>;
  createCommunityMessage(data: InsertCommunityMessage): Promise<CommunityMessage>;
  deleteCommunityMessage(id: string): Promise<void>;
  getCommunityReactions(messageIds: string[]): Promise<CommunityReaction[]>;
  toggleCommunityReaction(messageId: string, userId: string, emoji: string): Promise<{ added: boolean }>;
  isChatUsernameTaken(chatUsername: string, excludeUserId?: string): Promise<boolean>;

  getAllWordFilters(): Promise<ChatWordFilter[]>;
  addWordFilter(word: string): Promise<ChatWordFilter>;
  deleteWordFilter(id: string): Promise<void>;
  getBannedUsers(): Promise<User[]>;

  getTelegramSettings(): Promise<TelegramSettings | undefined>;
  updateTelegramSettings(data: { chatId?: string | null; enabled?: boolean; sendAlerts?: boolean; sendServiceUpdates?: boolean; sendNews?: boolean }): Promise<TelegramSettings>;
  getDiscordSettings(): Promise<DiscordSettings | undefined>;
  updateDiscordSettings(data: { webhookUrl?: string | null; enabled?: boolean; sendAlerts?: boolean; sendServiceUpdates?: boolean; sendNews?: boolean }): Promise<DiscordSettings>;
  getBusinessHours(): Promise<BusinessHours>;
  updateBusinessHours(data: UpdateBusinessHoursData): Promise<BusinessHours>;

  listAnnouncements(): Promise<Announcement[]>;
  getAnnouncement(id: string): Promise<Announcement | undefined>;
  getActiveAnnouncement(): Promise<Announcement | undefined>;
  createAnnouncement(data: InsertAnnouncement & { createdByUserId: string }): Promise<Announcement>;
  updateAnnouncement(id: string, data: UpdateAnnouncement): Promise<Announcement | undefined>;
  deleteAnnouncement(id: string): Promise<void>;
  hasUserSeenAnnouncement(announcementId: string, userId: string): Promise<boolean>;
  markAnnouncementSeen(announcementId: string, userId: string): Promise<void>;

  listKbCategories(): Promise<KbCategory[]>;
  getKbCategory(id: string): Promise<KbCategory | undefined>;
  createKbCategory(data: InsertKbCategory): Promise<KbCategory>;
  updateKbCategory(id: string, data: UpdateKbCategory): Promise<KbCategory | undefined>;
  deleteKbCategory(id: string): Promise<void>;

  listKbArticles(opts?: { publishedOnly?: boolean; categoryId?: string }): Promise<KbArticle[]>;
  getKbArticleById(id: string): Promise<KbArticle | undefined>;
  getKbArticleBySlug(slug: string): Promise<KbArticle | undefined>;
  createKbArticle(data: InsertKbArticle & { authorId: string | null }): Promise<KbArticle>;
  updateKbArticle(id: string, data: UpdateKbArticle): Promise<KbArticle | undefined>;
  deleteKbArticle(id: string): Promise<void>;
  incrementKbArticleViewCount(id: string): Promise<void>;
  recordKbArticleHelpful(id: string, helpful: boolean): Promise<KbArticle | undefined>;
  searchKbArticles(query: string, opts?: { limit?: number; publishedOnly?: boolean }): Promise<KbArticle[]>;

  getDashboardMetrics(): Promise<DashboardMetrics>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [created] = await db.insert(users).values(user).returning();
    return created;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllServices(): Promise<Service[]> {
    return db.select().from(services);
  }

  async getService(id: string): Promise<Service | undefined> {
    const [service] = await db.select().from(services).where(eq(services.id, id));
    return service;
  }

  async createService(service: InsertService): Promise<Service> {
    const [created] = await db.insert(services).values(service).returning();
    return created;
  }

  async updateService(id: string, data: Partial<Service>): Promise<Service | undefined> {
    const [updated] = await db.update(services).set(data).where(eq(services.id, id)).returning();
    return updated;
  }

  async deleteService(id: string): Promise<void> {
    await db.delete(services).where(eq(services.id, id));
  }

  async getAllAlerts(): Promise<ServiceAlert[]> {
    return db.select().from(serviceAlerts).orderBy(desc(serviceAlerts.createdAt));
  }

  async getAlert(id: string): Promise<ServiceAlert | undefined> {
    const [alert] = await db.select().from(serviceAlerts).where(eq(serviceAlerts.id, id));
    return alert;
  }

  async createAlert(alert: InsertServiceAlert): Promise<ServiceAlert> {
    const [created] = await db.insert(serviceAlerts).values(alert).returning();
    return created;
  }

  async updateAlert(id: string, data: Partial<ServiceAlert>): Promise<ServiceAlert | undefined> {
    const [updated] = await db.update(serviceAlerts).set(data).where(eq(serviceAlerts.id, id)).returning();
    return updated;
  }

  async deleteAlert(id: string): Promise<void> {
    await db.delete(alertUpdates).where(eq(alertUpdates.alertId, id));
    await db.delete(serviceAlerts).where(eq(serviceAlerts.id, id));
  }

  async getAlertNotificationRecipientIds(alertId: string): Promise<string[]> {
    const rows = await db.selectDistinct({ userId: userNotifications.userId })
      .from(userNotifications)
      .where(and(eq(userNotifications.referenceType, "alert"), eq(userNotifications.referenceId, alertId)));
    return rows.map(r => r.userId);
  }

  async getPublicStatusSubscribers(): Promise<PublicStatusSubscriber[]> {
    return db.select().from(publicStatusSubscribers).orderBy(desc(publicStatusSubscribers.createdAt));
  }

  async getPublicStatusSubscriberByEmail(email: string): Promise<PublicStatusSubscriber | undefined> {
    const [row] = await db.select().from(publicStatusSubscribers).where(eq(publicStatusSubscribers.email, email));
    return row;
  }

  async getPublicStatusSubscriberByToken(token: string): Promise<PublicStatusSubscriber | undefined> {
    const [row] = await db.select().from(publicStatusSubscribers).where(eq(publicStatusSubscribers.unsubscribeToken, token));
    return row;
  }

  async createPublicStatusSubscriber(email: string, unsubscribeToken: string): Promise<PublicStatusSubscriber> {
    const [created] = await db.insert(publicStatusSubscribers).values({ email, unsubscribeToken }).returning();
    return created;
  }

  async deletePublicStatusSubscriberByToken(token: string): Promise<boolean> {
    const result = await db.delete(publicStatusSubscribers).where(eq(publicStatusSubscribers.unsubscribeToken, token)).returning();
    return result.length > 0;
  }

  async getAlertUpdates(alertId: string): Promise<AlertUpdate[]> {
    return db.select().from(alertUpdates).where(eq(alertUpdates.alertId, alertId)).orderBy(desc(alertUpdates.createdAt));
  }

  async createAlertUpdate(update: InsertAlertUpdate): Promise<AlertUpdate> {
    const [created] = await db.insert(alertUpdates).values(update).returning();
    return created;
  }

  async updateAlertUpdate(id: string, data: Partial<{ message: string; imageUrl: string | null }>): Promise<AlertUpdate | undefined> {
    const [updated] = await db.update(alertUpdates).set(data).where(eq(alertUpdates.id, id)).returning();
    return updated;
  }

  async getAllNews(): Promise<NewsStory[]> {
    return db.select().from(newsStories).orderBy(desc(newsStories.createdAt));
  }

  async getNewsStory(id: string): Promise<NewsStory | undefined> {
    const [story] = await db.select().from(newsStories).where(eq(newsStories.id, id));
    return story;
  }

  async createNewsStory(story: InsertNewsStory): Promise<NewsStory> {
    const [created] = await db.insert(newsStories).values(story).returning();
    return created;
  }

  async updateNewsStory(id: string, data: Partial<InsertNewsStory>): Promise<NewsStory | undefined> {
    const [updated] = await db.update(newsStories).set(data).where(eq(newsStories.id, id)).returning();
    return updated;
  }

  async deleteNewsStory(id: string): Promise<void> {
    await db.delete(newsStories).where(eq(newsStories.id, id));
  }

  async getAllTickets(): Promise<Ticket[]> {
    return db.select().from(tickets).orderBy(desc(tickets.createdAt));
  }

  async getTicketsByCustomer(customerId: string): Promise<Ticket[]> {
    return db.select().from(tickets).where(eq(tickets.customerId, customerId)).orderBy(desc(tickets.createdAt));
  }

  async getTicket(id: string): Promise<Ticket | undefined> {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, id));
    return ticket;
  }

  async createTicket(ticket: InsertTicket): Promise<Ticket> {
    const [created] = await db.insert(tickets).values(ticket).returning();
    return created;
  }

  async updateTicket(id: string, data: Partial<Ticket>): Promise<Ticket | undefined> {
    const [updated] = await db.update(tickets).set(data).where(eq(tickets.id, id)).returning();
    return updated;
  }

  async deleteTicket(id: string): Promise<void> {
    await db.delete(ticketMessages).where(eq(ticketMessages.ticketId, id));
    await db.delete(ticketNotifications).where(eq(ticketNotifications.ticketId, id));
    await db.delete(tickets).where(eq(tickets.id, id));
  }

  async getTicketMessages(ticketId: string): Promise<TicketMessage[]> {
    return db.select().from(ticketMessages).where(eq(ticketMessages.ticketId, ticketId)).orderBy(ticketMessages.createdAt);
  }

  async markTicketMessagesRead(ticketId: string, readerId: string): Promise<void> {
    await db.update(ticketMessages).set({ readAt: new Date() }).where(
      and(
        eq(ticketMessages.ticketId, ticketId),
        isNull(ticketMessages.readAt),
        sql`${ticketMessages.senderId} != ${readerId}`
      )
    );
  }

  async createTicketMessage(message: InsertTicketMessage): Promise<TicketMessage> {
    const [created] = await db.insert(ticketMessages).values(message).returning();
    return created;
  }

  async createPrivateMessage(message: InsertPrivateMessage): Promise<PrivateMessage> {
    const [created] = await db.insert(privateMessages).values(message).returning();
    return created;
  }

  async getPrivateMessagesByUser(userId: string): Promise<PrivateMessage[]> {
    return db.select().from(privateMessages).where(eq(privateMessages.recipientId, userId)).orderBy(desc(privateMessages.createdAt));
  }

  async getUnreadPrivateMessageCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(privateMessages).where(and(eq(privateMessages.recipientId, userId), isNull(privateMessages.readAt)));
    return result[0]?.count ?? 0;
  }

  async getPrivateMessagesBySender(senderId: string): Promise<PrivateMessage[]> {
    return db.select().from(privateMessages).where(eq(privateMessages.senderId, senderId)).orderBy(desc(privateMessages.createdAt));
  }

  async markPrivateMessageRead(id: string): Promise<PrivateMessage | undefined> {
    const [updated] = await db.update(privateMessages).set({ readAt: new Date() }).where(eq(privateMessages.id, id)).returning();
    return updated;
  }

  async deletePrivateMessage(id: string): Promise<void> {
    await db.delete(privateMessages).where(eq(privateMessages.id, id));
  }

  async createTicketNotification(notification: InsertTicketNotification): Promise<TicketNotification> {
    const [created] = await db.insert(ticketNotifications).values(notification).returning();
    return created;
  }

  async getUnreadTicketNotificationCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(ticketNotifications).where(and(eq(ticketNotifications.userId, userId), isNull(ticketNotifications.readAt)));
    return result[0]?.count ?? 0;
  }

  async getTicketNotificationsByUser(userId: string): Promise<TicketNotification[]> {
    return db.select().from(ticketNotifications).where(eq(ticketNotifications.userId, userId)).orderBy(desc(ticketNotifications.createdAt));
  }

  async markTicketNotificationsRead(userId: string): Promise<void> {
    await db.update(ticketNotifications).set({ readAt: new Date() }).where(and(eq(ticketNotifications.userId, userId), isNull(ticketNotifications.readAt)));
  }

  async deleteTicketNotificationsByTicket(ticketId: string): Promise<void> {
    await db.delete(ticketNotifications).where(eq(ticketNotifications.ticketId, ticketId));
  }

  async getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async getAllPushSubscriptions(): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions);
  }

  async createPushSubscription(sub: InsertPushSubscription): Promise<PushSubscription> {
    const existing = await this.getPushSubscriptionByEndpoint(sub.endpoint);
    if (existing) {
      const [updated] = await db.update(pushSubscriptions).set(sub).where(eq(pushSubscriptions.endpoint, sub.endpoint)).returning();
      return updated;
    }
    const [created] = await db.insert(pushSubscriptions).values(sub).returning();
    return created;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async getPushSubscriptionByEndpoint(endpoint: string): Promise<PushSubscription | undefined> {
    const [sub] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
    return sub;
  }

  async getAllQuickResponses(): Promise<QuickResponse[]> {
    return db.select().from(quickResponses).orderBy(desc(quickResponses.createdAt));
  }

  async getQuickResponse(id: string): Promise<QuickResponse | undefined> {
    const [qr] = await db.select().from(quickResponses).where(eq(quickResponses.id, id));
    return qr;
  }

  async createQuickResponse(qr: InsertQuickResponse): Promise<QuickResponse> {
    const [created] = await db.insert(quickResponses).values(qr).returning();
    return created;
  }

  async updateQuickResponse(id: string, data: Partial<QuickResponse>): Promise<QuickResponse | undefined> {
    const [updated] = await db.update(quickResponses).set(data).where(eq(quickResponses.id, id)).returning();
    return updated;
  }

  async deleteQuickResponse(id: string): Promise<void> {
    await db.delete(quickResponses).where(eq(quickResponses.id, id));
  }

  async getAllReportRequests(): Promise<ReportRequest[]> {
    return db.select().from(reportRequests).orderBy(desc(reportRequests.createdAt));
  }

  async getReportRequestsByCustomer(customerId: string): Promise<ReportRequest[]> {
    return db.select().from(reportRequests).where(eq(reportRequests.customerId, customerId)).orderBy(desc(reportRequests.createdAt));
  }

  async createReportRequest(rr: InsertReportRequest): Promise<ReportRequest> {
    const [created] = await db.insert(reportRequests).values(rr).returning();
    return created;
  }

  async updateReportRequest(id: string, data: Partial<ReportRequest>): Promise<ReportRequest | undefined> {
    const [updated] = await db.update(reportRequests).set(data).where(eq(reportRequests.id, id)).returning();
    return updated;
  }

  async deleteReportRequest(id: string): Promise<void> {
    await db.delete(reportRequests).where(eq(reportRequests.id, id));
  }

  async createReportNotification(notification: InsertReportNotification): Promise<ReportNotification> {
    const [created] = await db.insert(reportNotifications).values(notification).returning();
    return created;
  }

  async getUnreadReportNotificationCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(reportNotifications).where(and(eq(reportNotifications.userId, userId), isNull(reportNotifications.readAt)));
    return Number(result[0]?.count ?? 0);
  }

  async markReportNotificationsRead(userId: string): Promise<void> {
    await db.update(reportNotifications).set({ readAt: new Date() }).where(and(eq(reportNotifications.userId, userId), isNull(reportNotifications.readAt)));
  }

  async createContentNotification(userId: string, category: string, message: string, referenceId?: string): Promise<void> {
    await db.insert(contentNotifications).values({ userId, category, message, referenceId: referenceId || null });
  }

  async createContentNotificationBulk(userIds: string[], category: string, message: string, referenceId?: string): Promise<void> {
    if (userIds.length === 0) return;
    const values = userIds.map(userId => ({ userId, category, message, referenceId: referenceId || null }));
    await db.insert(contentNotifications).values(values);
  }

  async getUnreadContentNotificationCounts(userId: string): Promise<Record<string, number>> {
    const results = await db.select({
      category: contentNotifications.category,
      count: sql<number>`count(*)`,
    }).from(contentNotifications).where(and(eq(contentNotifications.userId, userId), isNull(contentNotifications.readAt))).groupBy(contentNotifications.category);
    const counts: Record<string, number> = {};
    for (const r of results) {
      counts[r.category] = Number(r.count);
    }
    return counts;
  }

  async getUnreadContentNotificationReferenceIds(userId: string, category: string): Promise<string[]> {
    const results = await db.select({ referenceId: contentNotifications.referenceId })
      .from(contentNotifications)
      .where(and(
        eq(contentNotifications.userId, userId),
        eq(contentNotifications.category, category),
        isNull(contentNotifications.readAt),
      ));
    return results.map(r => r.referenceId).filter(Boolean) as string[];
  }

  async markContentNotificationsRead(userId: string, category: string): Promise<void> {
    await db.update(contentNotifications).set({ readAt: new Date() }).where(and(eq(contentNotifications.userId, userId), eq(contentNotifications.category, category), isNull(contentNotifications.readAt)));
  }

  async getAllServiceUpdates(): Promise<ServiceUpdate[]> {
    return db.select().from(serviceUpdates).orderBy(desc(serviceUpdates.createdAt));
  }

  async createServiceUpdate(update: InsertServiceUpdate): Promise<ServiceUpdate> {
    const [created] = await db.insert(serviceUpdates).values(update).returning();
    return created;
  }

  async updateServiceUpdate(id: string, data: Partial<{ title: string; description: string; matureContent: boolean }>): Promise<ServiceUpdate | undefined> {
    const [updated] = await db.update(serviceUpdates).set(data).where(eq(serviceUpdates.id, id)).returning();
    return updated;
  }

  async deleteServiceUpdate(id: string): Promise<void> {
    await db.delete(hiddenServiceUpdates).where(eq(hiddenServiceUpdates.serviceUpdateId, id));
    await db.delete(serviceUpdates).where(eq(serviceUpdates.id, id));
  }

  async hideServiceUpdate(userId: string, serviceUpdateId: string): Promise<void> {
    await db.insert(hiddenServiceUpdates).values({ userId, serviceUpdateId }).onConflictDoNothing();
  }

  async getHiddenServiceUpdateIds(userId: string): Promise<string[]> {
    const rows = await db.select({ serviceUpdateId: hiddenServiceUpdates.serviceUpdateId })
      .from(hiddenServiceUpdates)
      .where(eq(hiddenServiceUpdates.userId, userId));
    return rows.map(r => r.serviceUpdateId);
  }

  async getAllEmailTemplates(): Promise<EmailTemplate[]> {
    return db.select().from(emailTemplates).orderBy(emailTemplates.name);
  }

  async getEmailTemplateByKey(key: string): Promise<EmailTemplate | undefined> {
    const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.templateKey, key));
    return template;
  }

  async updateEmailTemplate(id: string, data: Partial<EmailTemplate>): Promise<EmailTemplate | undefined> {
    const [updated] = await db.update(emailTemplates).set(data).where(eq(emailTemplates.id, id)).returning();
    return updated;
  }

  async upsertEmailTemplate(data: { templateKey: string; name: string; subject: string; body: string; availableVariables: string[]; description: string }): Promise<void> {
    const existing = await this.getEmailTemplateByKey(data.templateKey);
    if (!existing) {
      await db.insert(emailTemplates).values(data);
    } else if (existing.customized) {
      const existingVars = JSON.stringify(existing.availableVariables?.sort() || []);
      const newVars = JSON.stringify([...data.availableVariables].sort());
      if (existingVars !== newVars) {
        await db.update(emailTemplates).set({
          availableVariables: data.availableVariables,
          description: data.description,
        }).where(eq(emailTemplates.templateKey, data.templateKey));
      }
    } else {
      const existingVars = JSON.stringify(existing.availableVariables?.sort() || []);
      const newVars = JSON.stringify([...data.availableVariables].sort());
      if (existingVars !== newVars || existing.body !== data.body || existing.subject !== data.subject) {
        await db.update(emailTemplates).set({
          body: data.body,
          subject: data.subject,
          availableVariables: data.availableVariables,
          description: data.description,
        }).where(eq(emailTemplates.templateKey, data.templateKey));
      }
    }
  }

  async getAllAdminRoles(): Promise<AdminRole[]> {
    return db.select().from(adminRoles).orderBy(adminRoles.name);
  }

  async getAdminRole(id: string): Promise<AdminRole | undefined> {
    const [role] = await db.select().from(adminRoles).where(eq(adminRoles.id, id));
    return role;
  }

  async createAdminRole(role: InsertAdminRole): Promise<AdminRole> {
    const [created] = await db.insert(adminRoles).values(role).returning();
    return created;
  }

  async updateAdminRole(id: string, data: Partial<AdminRole>): Promise<AdminRole | undefined> {
    const [updated] = await db.update(adminRoles).set(data).where(eq(adminRoles.id, id)).returning();
    return updated;
  }

  async deleteAdminRole(id: string): Promise<void> {
    await db.update(users).set({ adminRoleId: null }).where(eq(users.adminRoleId, id));
    await db.delete(adminRoles).where(eq(adminRoles.id, id));
  }

  async getAllTicketCategories(): Promise<TicketCategory[]> {
    return db.select().from(ticketCategories).orderBy(ticketCategories.name);
  }

  async getTicketCategory(id: string): Promise<TicketCategory | undefined> {
    const [cat] = await db.select().from(ticketCategories).where(eq(ticketCategories.id, id));
    return cat;
  }

  async createTicketCategory(cat: InsertTicketCategory): Promise<TicketCategory> {
    const [created] = await db.insert(ticketCategories).values(cat).returning();
    return created;
  }

  async updateTicketCategory(id: string, data: Partial<TicketCategory>): Promise<TicketCategory | undefined> {
    const [updated] = await db.update(ticketCategories).set(data).where(eq(ticketCategories.id, id)).returning();
    return updated;
  }

  async deleteTicketCategory(id: string): Promise<void> {
    await db.delete(ticketCategories).where(eq(ticketCategories.id, id));
  }

  async createAdminChatThread(thread: InsertAdminChatThread): Promise<AdminChatThread> {
    const [created] = await db.insert(adminChatThreads).values(thread).returning();
    return created;
  }

  async getAdminChatThreadsForUser(userId: string): Promise<AdminChatThread[]> {
    const participantRows = await db.select({ threadId: adminChatParticipants.threadId })
      .from(adminChatParticipants)
      .where(eq(adminChatParticipants.userId, userId));
    const threadIds = participantRows.map(r => r.threadId);
    if (threadIds.length === 0) return [];
    const threads = await db.select().from(adminChatThreads)
      .where(inArray(adminChatThreads.id, threadIds))
      .orderBy(desc(adminChatThreads.createdAt));
    return threads;
  }

  async getAdminChatThread(id: string): Promise<AdminChatThread | undefined> {
    const [thread] = await db.select().from(adminChatThreads).where(eq(adminChatThreads.id, id));
    return thread;
  }

  async deleteAdminChatThread(id: string): Promise<void> {
    await db.delete(adminChatMessages).where(eq(adminChatMessages.threadId, id));
    await db.delete(adminChatParticipants).where(eq(adminChatParticipants.threadId, id));
    await db.delete(adminChatThreads).where(eq(adminChatThreads.id, id));
  }

  async getAdminChatMessages(threadId: string): Promise<AdminChatMessage[]> {
    return db.select().from(adminChatMessages)
      .where(eq(adminChatMessages.threadId, threadId))
      .orderBy(adminChatMessages.createdAt);
  }

  async createAdminChatMessage(msg: InsertAdminChatMessage): Promise<AdminChatMessage> {
    const [created] = await db.insert(adminChatMessages).values(msg).returning();
    return created;
  }

  async addAdminChatParticipant(participant: InsertAdminChatParticipant): Promise<AdminChatParticipant> {
    const [created] = await db.insert(adminChatParticipants).values(participant).returning();
    return created;
  }

  async getAdminChatParticipants(threadId: string): Promise<AdminChatParticipant[]> {
    return db.select().from(adminChatParticipants)
      .where(eq(adminChatParticipants.threadId, threadId));
  }

  async markAdminChatThreadRead(threadId: string, userId: string): Promise<void> {
    await db.update(adminChatParticipants)
      .set({ lastReadAt: new Date() })
      .where(and(
        eq(adminChatParticipants.threadId, threadId),
        eq(adminChatParticipants.userId, userId)
      ));
  }

  async getAdminChatUnreadCounts(userId: string): Promise<number> {
    const participantRows = await db.select({
      threadId: adminChatParticipants.threadId,
      lastReadAt: adminChatParticipants.lastReadAt,
    }).from(adminChatParticipants)
      .where(eq(adminChatParticipants.userId, userId));
    if (participantRows.length === 0) return 0;
    let count = 0;
    for (const row of participantRows) {
      let query = db.select({ id: adminChatMessages.id }).from(adminChatMessages)
        .where(
          row.lastReadAt
            ? and(
                eq(adminChatMessages.threadId, row.threadId),
                sql`${adminChatMessages.createdAt} > ${row.lastReadAt}`,
                sql`${adminChatMessages.senderId} != ${userId}`
              )
            : and(
                eq(adminChatMessages.threadId, row.threadId),
                sql`${adminChatMessages.senderId} != ${userId}`
              )
        );
      const msgs = await query;
      if (msgs.length > 0) count++;
    }
    return count;
  }

  async getAdminChatUnreadThreadIds(userId: string): Promise<string[]> {
    const participantRows = await db.select({
      threadId: adminChatParticipants.threadId,
      lastReadAt: adminChatParticipants.lastReadAt,
    }).from(adminChatParticipants)
      .where(eq(adminChatParticipants.userId, userId));
    if (participantRows.length === 0) return [];
    const unreadIds: string[] = [];
    for (const row of participantRows) {
      const msgs = await db.select({ id: adminChatMessages.id }).from(adminChatMessages)
        .where(
          row.lastReadAt
            ? and(
                eq(adminChatMessages.threadId, row.threadId),
                sql`${adminChatMessages.createdAt} > ${row.lastReadAt}`,
                sql`${adminChatMessages.senderId} != ${userId}`
              )
            : and(
                eq(adminChatMessages.threadId, row.threadId),
                sql`${adminChatMessages.senderId} != ${userId}`
              )
        );
      if (msgs.length > 0) unreadIds.push(row.threadId);
    }
    return unreadIds;
  }

  async createBroadcastMessage(data: InsertBroadcastMessage, recipientIds: string[]): Promise<BroadcastMessage> {
    const [msg] = await db.insert(broadcastMessages).values(data).returning();
    for (const recipientId of recipientIds) {
      await db.insert(broadcastRecipients).values({ broadcastId: msg.id, recipientId });
    }
    return msg;
  }

  async getUnreadBroadcasts(userId: string): Promise<BroadcastMessage[]> {
    const rows = await db.select({
      broadcastId: broadcastRecipients.broadcastId,
    }).from(broadcastRecipients)
      .where(and(
        eq(broadcastRecipients.recipientId, userId),
        isNull(broadcastRecipients.readAt)
      ));
    if (rows.length === 0) return [];
    const ids = rows.map(r => r.broadcastId);
    const msgs = await db.select().from(broadcastMessages)
      .where(inArray(broadcastMessages.id, ids))
      .orderBy(broadcastMessages.createdAt);
    return msgs;
  }

  async markBroadcastRead(broadcastId: string, userId: string): Promise<void> {
    await db.update(broadcastRecipients)
      .set({ readAt: new Date() })
      .where(and(
        eq(broadcastRecipients.broadcastId, broadcastId),
        eq(broadcastRecipients.recipientId, userId)
      ));
  }

  async createTicketTransfer(data: InsertTicketTransfer): Promise<TicketTransfer> {
    const [transfer] = await db.insert(ticketTransfers).values(data).returning();
    return transfer;
  }

  async getPendingTransfersForAdmin(adminId: string): Promise<TicketTransfer[]> {
    return db.select().from(ticketTransfers)
      .where(and(eq(ticketTransfers.toAdminId, adminId), eq(ticketTransfers.status, "pending")))
      .orderBy(desc(ticketTransfers.createdAt));
  }

  async getPendingTransferByTicketId(ticketId: string): Promise<TicketTransfer | undefined> {
    const [transfer] = await db.select().from(ticketTransfers)
      .where(and(eq(ticketTransfers.ticketId, ticketId), eq(ticketTransfers.status, "pending")));
    return transfer;
  }

  async updateTicketTransfer(id: string, data: Partial<TicketTransfer>): Promise<TicketTransfer | undefined> {
    const [transfer] = await db.update(ticketTransfers).set(data).where(eq(ticketTransfers.id, id)).returning();
    return transfer;
  }

  async createActivityLog(data: InsertAdminActivityLog): Promise<AdminActivityLog> {
    const [log] = await db.insert(adminActivityLogs).values(data).returning();
    return log;
  }

  async getActivityLogs(filters: { category?: string; action?: string; search?: string; page?: number; limit?: number }): Promise<{ logs: AdminActivityLog[]; total: number }> {
    const page = filters.page || 1;
    const limit = filters.limit || 50;
    const offset = (page - 1) * limit;
    const conditions = [];
    if (filters.category) conditions.push(eq(adminActivityLogs.category, filters.category));
    if (filters.action) conditions.push(eq(adminActivityLogs.action, filters.action));
    if (filters.search) conditions.push(sql`${adminActivityLogs.summary} ILIKE ${'%' + filters.search + '%'}`);
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const logs = await db.select().from(adminActivityLogs).where(where).orderBy(desc(adminActivityLogs.createdAt)).limit(limit).offset(offset);
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(adminActivityLogs).where(where);
    return { logs, total: countResult?.count || 0 };
  }

  async getActivityLog(id: string): Promise<AdminActivityLog | undefined> {
    const [log] = await db.select().from(adminActivityLogs).where(eq(adminActivityLogs.id, id));
    return log;
  }

  async getAllDownloads(): Promise<Download[]> {
    return db.select().from(downloads).orderBy(desc(downloads.createdAt));
  }

  async getDownload(id: string): Promise<Download | undefined> {
    const [dl] = await db.select().from(downloads).where(eq(downloads.id, id));
    return dl;
  }

  async createDownload(data: InsertDownload): Promise<Download> {
    const [dl] = await db.insert(downloads).values(data).returning();
    return dl;
  }

  async updateDownload(id: string, data: Partial<Download>): Promise<Download | undefined> {
    const [dl] = await db.update(downloads).set(data).where(eq(downloads.id, id)).returning();
    return dl;
  }

  async deleteDownload(id: string): Promise<void> {
    await db.delete(downloads).where(eq(downloads.id, id));
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createPasswordResetToken(data: InsertPasswordResetToken): Promise<PasswordResetToken> {
    const [token] = await db.insert(passwordResetTokens).values(data).returning();
    return token;
  }

  async getPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | undefined> {
    const [token] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, tokenHash));
    return token;
  }

  async markPasswordResetTokenUsed(id: string): Promise<void> {
    await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, id));
  }

  async getAllUrlMonitors(): Promise<UrlMonitor[]> {
    return db.select().from(urlMonitors).orderBy(desc(urlMonitors.createdAt));
  }

  async getUrlMonitor(id: string): Promise<UrlMonitor | undefined> {
    const [m] = await db.select().from(urlMonitors).where(eq(urlMonitors.id, id));
    return m;
  }

  async createUrlMonitor(data: InsertUrlMonitor): Promise<UrlMonitor> {
    const [m] = await db.insert(urlMonitors).values(data).returning();
    return m;
  }

  async updateUrlMonitor(id: string, data: Partial<UrlMonitor>): Promise<UrlMonitor | undefined> {
    const [m] = await db.update(urlMonitors).set(data).where(eq(urlMonitors.id, id)).returning();
    return m;
  }

  async deleteUrlMonitor(id: string): Promise<void> {
    await db.delete(monitorIncidents).where(eq(monitorIncidents.monitorId, id));
    await db.delete(urlMonitors).where(eq(urlMonitors.id, id));
  }

  async getMonitorIncidents(monitorId: string): Promise<MonitorIncident[]> {
    return db.select().from(monitorIncidents).where(eq(monitorIncidents.monitorId, monitorId)).orderBy(desc(monitorIncidents.startedAt));
  }

  async getOpenIncident(monitorId: string): Promise<MonitorIncident | undefined> {
    const [inc] = await db.select().from(monitorIncidents).where(and(eq(monitorIncidents.monitorId, monitorId), isNull(monitorIncidents.resolvedAt)));
    return inc;
  }

  async getOpenIncidents(monitorId: string): Promise<MonitorIncident[]> {
    return db.select().from(monitorIncidents).where(and(eq(monitorIncidents.monitorId, monitorId), isNull(monitorIncidents.resolvedAt))).orderBy(desc(monitorIncidents.startedAt));
  }

  async createMonitorIncident(data: InsertMonitorIncident): Promise<MonitorIncident> {
    const [inc] = await db.insert(monitorIncidents).values(data).returning();
    return inc;
  }

  async updateMonitorIncident(id: string, data: Partial<MonitorIncident>): Promise<MonitorIncident | undefined> {
    const [inc] = await db.update(monitorIncidents).set(data).where(eq(monitorIncidents.id, id)).returning();
    return inc;
  }

  async getMonitorsByService(serviceId: string): Promise<UrlMonitor[]> {
    return db.select().from(urlMonitors).where(eq(urlMonitors.serviceId, serviceId));
  }

  async createServiceSubscriber(data: InsertServiceSubscriber): Promise<ServiceSubscriber> {
    const [s] = await db.insert(serviceSubscribers).values(data).returning();
    return s;
  }

  async getServiceSubscriberByToken(token: string): Promise<ServiceSubscriber | undefined> {
    const [s] = await db.select().from(serviceSubscribers).where(eq(serviceSubscribers.unsubscribeToken, token));
    return s;
  }

  async findServiceSubscriber(email: string, serviceId: string): Promise<ServiceSubscriber | undefined> {
    const [s] = await db.select().from(serviceSubscribers).where(and(eq(serviceSubscribers.email, email), eq(serviceSubscribers.serviceId, serviceId)));
    return s;
  }

  async confirmServiceSubscriber(id: string): Promise<ServiceSubscriber | undefined> {
    const [s] = await db.update(serviceSubscribers).set({ confirmedAt: new Date() }).where(eq(serviceSubscribers.id, id)).returning();
    return s;
  }

  async deleteServiceSubscriber(id: string): Promise<void> {
    await db.delete(serviceSubscribers).where(eq(serviceSubscribers.id, id));
  }

  async updateServiceSubscriberEvents(id: string, events: string[]): Promise<void> {
    await db.update(serviceSubscribers).set({ events }).where(eq(serviceSubscribers.id, id));
  }

  async getConfirmedSubscribersForService(serviceId: string): Promise<ServiceSubscriber[]> {
    return db.select().from(serviceSubscribers).where(and(eq(serviceSubscribers.serviceId, serviceId), isNotNull(serviceSubscribers.confirmedAt)));
  }

  async createMessageThread(data: InsertMessageThread): Promise<MessageThread> {
    const [t] = await db.insert(messageThreads).values(data).returning();
    return t;
  }

  async getMessageThread(id: string): Promise<MessageThread | undefined> {
    const [t] = await db.select().from(messageThreads).where(eq(messageThreads.id, id));
    return t;
  }

  async getMessageThreadsForUser(userId: string, role: string): Promise<MessageThread[]> {
    if (role === "master_admin") {
      return db.select().from(messageThreads).orderBy(desc(messageThreads.lastMessageAt));
    }
    if (role === "admin") {
      return db.select().from(messageThreads).where(eq(messageThreads.adminId, userId)).orderBy(desc(messageThreads.lastMessageAt));
    }
    return db.select().from(messageThreads).where(eq(messageThreads.customerId, userId)).orderBy(desc(messageThreads.lastMessageAt));
  }

  async updateMessageThread(id: string, data: Partial<MessageThread>): Promise<MessageThread | undefined> {
    const [t] = await db.update(messageThreads).set(data).where(eq(messageThreads.id, id)).returning();
    return t;
  }

  async deleteMessageThread(id: string): Promise<void> {
    await db.delete(threadMessages).where(eq(threadMessages.threadId, id));
    await db.delete(messageThreads).where(eq(messageThreads.id, id));
  }

  async getThreadMessages(threadId: string): Promise<ThreadMessage[]> {
    return db.select().from(threadMessages).where(eq(threadMessages.threadId, threadId)).orderBy(threadMessages.createdAt);
  }

  async createThreadMessage(data: InsertThreadMessage): Promise<ThreadMessage> {
    const [m] = await db.insert(threadMessages).values(data).returning();
    return m;
  }

  async markThreadMessagesRead(threadId: string, userId: string): Promise<void> {
    await db.update(threadMessages).set({ readAt: new Date() }).where(
      and(
        eq(threadMessages.threadId, threadId),
        isNull(threadMessages.readAt),
        sql`${threadMessages.senderId} != ${userId}`
      )
    );
  }

  async getUnreadThreadMessageCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(threadMessages)
      .innerJoin(messageThreads, eq(threadMessages.threadId, messageThreads.id))
      .where(
        and(
          isNull(threadMessages.readAt),
          sql`${threadMessages.senderId} != ${userId}`,
          sql`(${messageThreads.customerId} = ${userId} OR ${messageThreads.adminId} = ${userId})`
        )
      );
    return result[0]?.count ?? 0;
  }

  async createUserNotification(data: InsertUserNotification): Promise<UserNotification> {
    const [created] = await db.insert(userNotifications).values(data).returning();
    return created;
  }

  async getUserNotifications(userId: string, limit = 50, offset = 0): Promise<UserNotification[]> {
    return db.select().from(userNotifications)
      .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.dismissedAt)))
      .orderBy(desc(userNotifications.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getUnreadUserNotificationCount(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(userNotifications)
      .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt), isNull(userNotifications.dismissedAt)));
    return result[0]?.count ?? 0;
  }

  async getUserNotification(id: string, userId: string): Promise<UserNotification | undefined> {
    const [notif] = await db.select().from(userNotifications).where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)));
    return notif;
  }

  async markUserNotificationRead(id: string, userId: string): Promise<void> {
    await db.update(userNotifications).set({ readAt: new Date() }).where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)));
  }

  async dismissUserNotification(id: string, userId: string): Promise<void> {
    await db.update(userNotifications).set({ dismissedAt: new Date(), readAt: sql`COALESCE(${userNotifications.readAt}, NOW())` }).where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)));
  }

  async markAllUserNotificationsRead(userId: string): Promise<void> {
    await db.update(userNotifications).set({ readAt: new Date() })
      .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt), isNull(userNotifications.dismissedAt)));
  }

  async dismissAllUserNotifications(userId: string): Promise<void> {
    await db.update(userNotifications).set({ dismissedAt: new Date(), readAt: sql`COALESCE(${userNotifications.readAt}, NOW())` })
      .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.dismissedAt)));
  }

  async markUserNotificationsByTypeRead(userId: string, types: string[]): Promise<void> {
    if (types.length === 0) return;
    await db.update(userNotifications).set({ readAt: new Date() })
      .where(and(
        eq(userNotifications.userId, userId),
        isNull(userNotifications.readAt),
        isNull(userNotifications.dismissedAt),
        inArray(userNotifications.type, types)
      ));
  }

  async deleteExpiredUserNotifications(daysOld: number): Promise<number> {
    const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
    const result = await db.delete(userNotifications).where(sql`${userNotifications.createdAt} < ${cutoff}`);
    return result.rowCount ?? 0;
  }

  async getCommunityMessages(limit: number = 50, before?: string): Promise<CommunityMessage[]> {
    if (before) {
      const [refMsg] = await db.select().from(communityMessages).where(eq(communityMessages.id, before));
      if (refMsg) {
        return db.select().from(communityMessages)
          .where(sql`${communityMessages.createdAt} < ${refMsg.createdAt}`)
          .orderBy(desc(communityMessages.createdAt))
          .limit(limit);
      }
    }
    return db.select().from(communityMessages)
      .orderBy(desc(communityMessages.createdAt))
      .limit(limit);
  }

  async createCommunityMessage(data: InsertCommunityMessage): Promise<CommunityMessage> {
    const [msg] = await db.insert(communityMessages).values(data).returning();
    return msg;
  }

  async deleteCommunityMessage(id: string): Promise<void> {
    await db.delete(communityReactions).where(eq(communityReactions.messageId, id));
    await db.delete(communityMessages).where(eq(communityMessages.id, id));
  }

  async getCommunityReactions(messageIds: string[]): Promise<CommunityReaction[]> {
    if (messageIds.length === 0) return [];
    return db.select().from(communityReactions)
      .where(inArray(communityReactions.messageId, messageIds));
  }

  async toggleCommunityReaction(messageId: string, userId: string, emoji: string): Promise<{ added: boolean }> {
    const [existing] = await db.select().from(communityReactions)
      .where(and(
        eq(communityReactions.messageId, messageId),
        eq(communityReactions.userId, userId),
        eq(communityReactions.emoji, emoji)
      ));
    if (existing) {
      await db.delete(communityReactions).where(eq(communityReactions.id, existing.id));
      return { added: false };
    }
    await db.insert(communityReactions).values({ messageId, userId, emoji });
    return { added: true };
  }

  async isChatUsernameTaken(chatUsername: string, excludeUserId?: string): Promise<boolean> {
    const lower = chatUsername.toLowerCase();
    const rows = await db.select({ id: users.id }).from(users)
      .where(sql`LOWER(${users.chatUsername}) = ${lower}`);
    if (excludeUserId) {
      return rows.some(r => r.id !== excludeUserId);
    }
    return rows.length > 0;
  }

  async getAllWordFilters(): Promise<ChatWordFilter[]> {
    return db.select().from(chatWordFilters).orderBy(chatWordFilters.word);
  }

  async addWordFilter(word: string): Promise<ChatWordFilter> {
    const [created] = await db.insert(chatWordFilters).values({ word: word.toLowerCase() }).returning();
    return created;
  }

  async deleteWordFilter(id: string): Promise<void> {
    await db.delete(chatWordFilters).where(eq(chatWordFilters.id, id));
  }

  async getBannedUsers(): Promise<User[]> {
    return db.select().from(users).where(eq(users.chatBanned, true));
  }

  async getTelegramSettings(): Promise<TelegramSettings | undefined> {
    const [row] = await db.select().from(telegramSettings).where(eq(telegramSettings.id, "singleton"));
    return row;
  }

  async updateTelegramSettings(data: { chatId?: string | null; enabled?: boolean; sendAlerts?: boolean; sendServiceUpdates?: boolean; sendNews?: boolean }): Promise<TelegramSettings> {
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (data.chatId !== undefined) patch.chatId = data.chatId;
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.sendAlerts !== undefined) patch.sendAlerts = data.sendAlerts;
    if (data.sendServiceUpdates !== undefined) patch.sendServiceUpdates = data.sendServiceUpdates;
    if (data.sendNews !== undefined) patch.sendNews = data.sendNews;
    const [updated] = await db.update(telegramSettings).set(patch).where(eq(telegramSettings.id, "singleton")).returning();
    if (updated) return updated;
    const [created] = await db.insert(telegramSettings).values({ id: "singleton", ...patch }).returning();
    return created;
  }

  async getDiscordSettings(): Promise<DiscordSettings | undefined> {
    const [row] = await db.select().from(discordSettings).where(eq(discordSettings.id, "singleton"));
    return row;
  }

  async updateDiscordSettings(data: { webhookUrl?: string | null; enabled?: boolean; sendAlerts?: boolean; sendServiceUpdates?: boolean; sendNews?: boolean }): Promise<DiscordSettings> {
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (data.webhookUrl !== undefined) patch.webhookUrl = data.webhookUrl;
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.sendAlerts !== undefined) patch.sendAlerts = data.sendAlerts;
    if (data.sendServiceUpdates !== undefined) patch.sendServiceUpdates = data.sendServiceUpdates;
    if (data.sendNews !== undefined) patch.sendNews = data.sendNews;
    const [updated] = await db.update(discordSettings).set(patch).where(eq(discordSettings.id, "singleton")).returning();
    if (updated) return updated;
    const [created] = await db.insert(discordSettings).values({ id: "singleton", ...patch }).returning();
    return created;
  }

  async getBusinessHours(): Promise<BusinessHours> {
    const [row] = await db.select().from(businessHours).where(eq(businessHours.id, "singleton"));
    if (row) return row;
    const [created] = await db.insert(businessHours).values({ id: "singleton" }).returning();
    return created;
  }

  async updateBusinessHours(data: UpdateBusinessHoursData): Promise<BusinessHours> {
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.daysOfWeek !== undefined) patch.daysOfWeek = data.daysOfWeek;
    if (data.startTime !== undefined) patch.startTime = data.startTime;
    if (data.endTime !== undefined) patch.endTime = data.endTime;
    if (data.timezone !== undefined) patch.timezone = data.timezone;
    if (data.afterHoursMessage !== undefined) patch.afterHoursMessage = data.afterHoursMessage;
    const [updated] = await db.update(businessHours).set(patch).where(eq(businessHours.id, "singleton")).returning();
    if (updated) return updated;
    const [created] = await db.insert(businessHours).values({ id: "singleton", ...patch }).returning();
    return created;
  }

  async listAnnouncements(): Promise<Announcement[]> {
    return db.select().from(announcements).orderBy(desc(announcements.createdAt));
  }

  async getAnnouncement(id: string): Promise<Announcement | undefined> {
    const [row] = await db.select().from(announcements).where(eq(announcements.id, id));
    return row;
  }

  async getActiveAnnouncement(): Promise<Announcement | undefined> {
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.active, true))
      .orderBy(desc(announcements.createdAt))
      .limit(1);
    return row;
  }

  async createAnnouncement(data: InsertAnnouncement & { createdByUserId: string }): Promise<Announcement> {
    const [created] = await db.insert(announcements).values({
      title: data.title,
      bodyHtml: data.bodyHtml,
      linkPath: data.linkPath ?? null,
      linkLabel: data.linkLabel ?? null,
      frequency: data.frequency ?? "once",
      active: data.active ?? true,
      createdByUserId: data.createdByUserId,
    }).returning();
    return created;
  }

  async updateAnnouncement(id: string, data: UpdateAnnouncement): Promise<Announcement | undefined> {
    const patch: Partial<typeof announcements.$inferInsert> = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.bodyHtml !== undefined) patch.bodyHtml = data.bodyHtml;
    if (data.linkPath !== undefined) patch.linkPath = data.linkPath ?? null;
    if (data.linkLabel !== undefined) patch.linkLabel = data.linkLabel ?? null;
    if (data.frequency !== undefined) patch.frequency = data.frequency;
    if (data.active !== undefined) patch.active = data.active;
    if (Object.keys(patch).length === 0) return this.getAnnouncement(id);
    const [updated] = await db.update(announcements).set(patch).where(eq(announcements.id, id)).returning();
    return updated;
  }

  async deleteAnnouncement(id: string): Promise<void> {
    await db.delete(announcementDismissals).where(eq(announcementDismissals.announcementId, id));
    await db.delete(announcements).where(eq(announcements.id, id));
  }

  async hasUserSeenAnnouncement(announcementId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select()
      .from(announcementDismissals)
      .where(and(
        eq(announcementDismissals.announcementId, announcementId),
        eq(announcementDismissals.userId, userId),
      ))
      .limit(1);
    return !!row;
  }

  async markAnnouncementSeen(announcementId: string, userId: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO announcement_dismissals (announcement_id, user_id)
      VALUES (${announcementId}, ${userId})
      ON CONFLICT (announcement_id, user_id) DO NOTHING
    `);
  }

  async listKbCategories(): Promise<KbCategory[]> {
    return db.select().from(kbCategories).orderBy(kbCategories.sortOrder, kbCategories.name);
  }

  async getKbCategory(id: string): Promise<KbCategory | undefined> {
    const [row] = await db.select().from(kbCategories).where(eq(kbCategories.id, id));
    return row;
  }

  async createKbCategory(data: InsertKbCategory): Promise<KbCategory> {
    const [created] = await db.insert(kbCategories).values({
      slug: data.slug,
      name: data.name,
      description: data.description ?? null,
      sortOrder: data.sortOrder ?? 0,
    }).returning();
    return created;
  }

  async updateKbCategory(id: string, data: UpdateKbCategory): Promise<KbCategory | undefined> {
    const patch: Partial<typeof kbCategories.$inferInsert> = {};
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description ?? null;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (Object.keys(patch).length === 0) return this.getKbCategory(id);
    const [updated] = await db.update(kbCategories).set(patch).where(eq(kbCategories.id, id)).returning();
    return updated;
  }

  async deleteKbCategory(id: string): Promise<void> {
    await db.delete(kbArticles).where(eq(kbArticles.categoryId, id));
    await db.delete(kbCategories).where(eq(kbCategories.id, id));
  }

  async listKbArticles(opts: { publishedOnly?: boolean; categoryId?: string } = {}): Promise<KbArticle[]> {
    const conditions = [] as any[];
    if (opts.publishedOnly) conditions.push(eq(kbArticles.published, true));
    if (opts.categoryId) conditions.push(eq(kbArticles.categoryId, opts.categoryId));
    const where = conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : and(...conditions);
    const q = db.select().from(kbArticles);
    const rows = where ? await q.where(where).orderBy(kbArticles.sortOrder, desc(kbArticles.createdAt)) : await q.orderBy(kbArticles.sortOrder, desc(kbArticles.createdAt));
    return rows;
  }

  async getKbArticleById(id: string): Promise<KbArticle | undefined> {
    const [row] = await db.select().from(kbArticles).where(eq(kbArticles.id, id));
    return row;
  }

  async getKbArticleBySlug(slug: string): Promise<KbArticle | undefined> {
    const [row] = await db.select().from(kbArticles).where(eq(kbArticles.slug, slug));
    return row;
  }

  async createKbArticle(data: InsertKbArticle & { authorId: string | null }): Promise<KbArticle> {
    const [created] = await db.insert(kbArticles).values({
      categoryId: data.categoryId,
      slug: data.slug,
      title: data.title,
      summary: data.summary ?? null,
      bodyHtml: data.bodyHtml,
      tags: data.tags ?? [],
      published: data.published ?? true,
      sortOrder: data.sortOrder ?? 0,
      authorId: data.authorId,
    }).returning();
    return created;
  }

  async updateKbArticle(id: string, data: UpdateKbArticle): Promise<KbArticle | undefined> {
    const patch: Partial<typeof kbArticles.$inferInsert> = {};
    if (data.categoryId !== undefined) patch.categoryId = data.categoryId;
    if (data.slug !== undefined) patch.slug = data.slug;
    if (data.title !== undefined) patch.title = data.title;
    if (data.summary !== undefined) patch.summary = data.summary ?? null;
    if (data.bodyHtml !== undefined) patch.bodyHtml = data.bodyHtml;
    if (data.tags !== undefined) patch.tags = data.tags;
    if (data.published !== undefined) patch.published = data.published;
    if (data.sortOrder !== undefined) patch.sortOrder = data.sortOrder;
    if (Object.keys(patch).length === 0) return this.getKbArticleById(id);
    const [updated] = await db.update(kbArticles).set(patch).where(eq(kbArticles.id, id)).returning();
    return updated;
  }

  async deleteKbArticle(id: string): Promise<void> {
    await db.delete(kbArticles).where(eq(kbArticles.id, id));
  }

  async incrementKbArticleViewCount(id: string): Promise<void> {
    await db.execute(sql`UPDATE kb_articles SET view_count = view_count + 1 WHERE id = ${id}`);
  }

  async recordKbArticleHelpful(id: string, helpful: boolean): Promise<KbArticle | undefined> {
    if (helpful) {
      await db.execute(sql`UPDATE kb_articles SET helpful_count = helpful_count + 1 WHERE id = ${id}`);
    } else {
      await db.execute(sql`UPDATE kb_articles SET unhelpful_count = unhelpful_count + 1 WHERE id = ${id}`);
    }
    return this.getKbArticleById(id);
  }

  async searchKbArticles(query: string, opts: { limit?: number; publishedOnly?: boolean } = {}): Promise<KbArticle[]> {
    const limit = opts.limit ?? 20;
    const trimmed = query.trim();
    if (!trimmed) return [];
    const publishedFilter = opts.publishedOnly ? sql`AND published = TRUE` : sql``;
    const result = await db.execute<KbArticle>(sql`
      SELECT id, category_id AS "categoryId", slug, title, summary, body_html AS "bodyHtml",
             tags, published, view_count AS "viewCount", helpful_count AS "helpfulCount",
             unhelpful_count AS "unhelpfulCount", sort_order AS "sortOrder",
             author_id AS "authorId", created_at AS "createdAt", updated_at AS "updatedAt"
      FROM kb_articles
      WHERE search_vector @@ plainto_tsquery('english', ${trimmed})
      ${publishedFilter}
      ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${trimmed})) DESC, created_at DESC
      LIMIT ${limit}
    `);
    return (result as any).rows ?? (result as any);
  }
  async getDashboardMetrics(): Promise<DashboardMetrics> {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const start14d = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const start24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const openTicketRows = await db.select({ id: tickets.id, customerId: tickets.customerId }).from(tickets).where(ne(tickets.status, "closed"));
    const openTicketIds = openTicketRows.map(t => t.id);

    const [
      lastMsgRows,
      openedTodayRow,
      resolvedTodayRow,
      ticketsLast14dRows,
      msgs7dRows,
      servicesRows,
      activeAlertRow,
      recentAlertsRows,
      pushSent24hRow,
      emailSent24hRow,
      pushSubsTotalRow,
      pushSubsThisWeekRow,
      kbTotalRow,
      kbPublishedRow,
      kbTopRows,
      community24hRow,
      communityActive7dRow,
      bannedRow,
      userRows,
      signupsTodayRow,
      signupsWeekRow,
    ] = await Promise.all([
      openTicketIds.length === 0
        ? Promise.resolve({ rows: [] } as any)
        : db.execute<{ ticket_id: string; sender_id: string }>(sql`
            SELECT DISTINCT ON (ticket_id) ticket_id, sender_id
            FROM ticket_messages
            WHERE ticket_id IN (${sql.join(openTicketIds.map(id => sql`${id}`), sql`, `)})
            ORDER BY ticket_id, created_at DESC
          `),
      db.select({ c: sql<number>`count(*)::int` }).from(tickets).where(gte(tickets.createdAt, startOfToday)),
      db.select({ c: sql<number>`count(*)::int` }).from(tickets).where(and(eq(tickets.status, "closed"), isNotNull(tickets.closedAt), gte(tickets.closedAt, startOfToday))),
      db.execute<{ day: string; opened: number; resolved: number }>(sql`
        WITH days AS (
          SELECT generate_series(${start14d}::date, ${now}::date, '1 day'::interval)::date AS day
        )
        SELECT
          to_char(d.day, 'YYYY-MM-DD') AS day,
          COALESCE((SELECT COUNT(*)::int FROM tickets WHERE created_at::date = d.day), 0) AS opened,
          COALESCE((SELECT COUNT(*)::int FROM tickets WHERE closed_at IS NOT NULL AND closed_at::date = d.day), 0) AS resolved
        FROM days d
        ORDER BY d.day ASC
      `),
      db.execute<{ ticket_id: string; first_admin_minutes: number }>(sql`
        WITH ticket_creators AS (
          SELECT t.id, t.created_at, t.customer_id
          FROM tickets t
          WHERE t.created_at >= ${start7d}
        ),
        first_admin AS (
          SELECT tm.ticket_id,
                 EXTRACT(EPOCH FROM (MIN(tm.created_at) - tc.created_at)) / 60.0 AS first_admin_minutes
          FROM ticket_messages tm
          JOIN ticket_creators tc ON tc.id = tm.ticket_id
          WHERE tm.sender_id <> tc.customer_id
          GROUP BY tm.ticket_id, tc.created_at
        )
        SELECT ticket_id, first_admin_minutes::float8 AS first_admin_minutes FROM first_admin
        WHERE first_admin_minutes >= 0
      `),
      db.select().from(services),
      db.select({ c: sql<number>`count(*)::int` }).from(serviceAlerts).where(isNull(serviceAlerts.resolvedAt)),
      db.select().from(serviceAlerts).orderBy(desc(serviceAlerts.createdAt)).limit(3),
      db.select({ c: sql<number>`count(*)::int` }).from(adminActivityLogs).where(and(eq(adminActivityLogs.category, "push"), gte(adminActivityLogs.createdAt, start24h))),
      db.select({ c: sql<number>`count(*)::int` }).from(adminActivityLogs).where(and(eq(adminActivityLogs.category, "email"), gte(adminActivityLogs.createdAt, start24h))),
      db.select({ c: sql<number>`count(*)::int` }).from(pushSubscriptions),
      db.select({ c: sql<number>`count(*)::int` }).from(pushSubscriptions).where(gte(pushSubscriptions.createdAt, start7d)),
      db.select({ c: sql<number>`count(*)::int` }).from(kbArticles),
      db.select({ c: sql<number>`count(*)::int` }).from(kbArticles).where(eq(kbArticles.published, true)),
      db.select({ id: kbArticles.id, title: kbArticles.title, slug: kbArticles.slug, viewCount: kbArticles.viewCount }).from(kbArticles).where(eq(kbArticles.published, true)).orderBy(desc(kbArticles.viewCount)).limit(5),
      db.select({ c: sql<number>`count(*)::int` }).from(communityMessages).where(gte(communityMessages.createdAt, start24h)),
      db.select({ c: sql<number>`count(DISTINCT user_id)::int` }).from(communityMessages).where(gte(communityMessages.createdAt, start7d)),
      db.select({ c: sql<number>`count(*)::int` }).from(users).where(eq(users.chatBanned, true)),
      db.select({ role: users.role, c: sql<number>`count(*)::int` }).from(users).groupBy(users.role),
      db.select({ c: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, startOfToday)),
      db.select({ c: sql<number>`count(*)::int` }).from(users).where(gte(users.createdAt, start7d)),
    ]);

    const lastMsgMap = new Map<string, string>();
    for (const r of (lastMsgRows as any).rows ?? (lastMsgRows as any)) {
      lastMsgMap.set(r.ticket_id, r.sender_id);
    }

    let awaitingCustomer = 0;
    let awaitingAdmin = 0;
    const openCount = openTicketRows.length;
    for (const t of openTicketRows) {
      const lastSender = lastMsgMap.get(t.id);
      if (!lastSender || lastSender === t.customerId) {
        awaitingAdmin++;
      } else {
        awaitingCustomer++;
      }
    }

    const series14dRaw = ((ticketsLast14dRows as any).rows ?? (ticketsLast14dRows as any)) as { day: string; opened: number; resolved: number }[];
    const series14d = series14dRaw.map(r => ({ date: r.day, opened: Number(r.opened) || 0, resolved: Number(r.resolved) || 0 }));

    const responseRows = ((msgs7dRows as any).rows ?? (msgs7dRows as any)) as { first_admin_minutes: number }[];
    const avgFirstResponseMinutes7d = responseRows.length > 0
      ? Math.round(responseRows.reduce((a, r) => a + Number(r.first_admin_minutes || 0), 0) / responseRows.length)
      : null;

    const operational = servicesRows.filter(s => s.status === "operational").length;
    const degraded = servicesRows.filter(s => s.status === "degraded").length;
    const down = servicesRows.filter(s => s.status === "down" || s.status === "outage").length;

    const userTotals = { total: 0, customers: 0, admins: 0 };
    for (const r of userRows) {
      const c = Number(r.c) || 0;
      userTotals.total += c;
      if (r.role === "customer") userTotals.customers += c;
      else userTotals.admins += c;
    }

    return {
      generatedAt: now.toISOString(),
      tickets: {
        open: openCount,
        awaitingCustomer,
        awaitingAdmin,
        openedToday: Number(openedTodayRow[0]?.c) || 0,
        resolvedToday: Number(resolvedTodayRow[0]?.c) || 0,
        avgFirstResponseMinutes7d,
        series14d,
      },
      services: {
        total: servicesRows.length,
        operational,
        degraded,
        down,
        activeAlerts: Number(activeAlertRow[0]?.c) || 0,
        recentAlerts: recentAlertsRows.map(a => ({ id: a.id, title: a.title, severity: a.severity, status: a.status, createdAt: a.createdAt.toISOString() })),
      },
      notifications: {
        pushSent24h: Number(pushSent24hRow[0]?.c) || 0,
        emailSent24h: Number(emailSent24hRow[0]?.c) || 0,
        pushSubscriptionsTotal: Number(pushSubsTotalRow[0]?.c) || 0,
        pushSubscriptionsThisWeek: Number(pushSubsThisWeekRow[0]?.c) || 0,
      },
      knowledgeBase: {
        total: Number(kbTotalRow[0]?.c) || 0,
        published: Number(kbPublishedRow[0]?.c) || 0,
        topViewed: kbTopRows.map(a => ({ id: a.id, title: a.title, slug: a.slug, viewCount: a.viewCount })),
      },
      community: {
        messages24h: Number(community24hRow[0]?.c) || 0,
        activeUsers7d: Number(communityActive7dRow[0]?.c) || 0,
        bannedUsers: Number(bannedRow[0]?.c) || 0,
      },
      users: {
        total: userTotals.total,
        customers: userTotals.customers,
        admins: userTotals.admins,
        signupsToday: Number(signupsTodayRow[0]?.c) || 0,
        signupsThisWeek: Number(signupsWeekRow[0]?.c) || 0,
      },
    };
  }
}

export const storage = new DatabaseStorage();
