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
  users, services, serviceAlerts, alertUpdates, newsStories, tickets, ticketMessages, privateMessages, ticketNotifications, pushSubscriptions, quickResponses, reportRequests, reportNotifications, contentNotifications, serviceUpdates, hiddenServiceUpdates, emailTemplates, adminRoles, ticketCategories, adminChatThreads, adminChatParticipants, adminChatMessages, broadcastMessages, broadcastRecipients, ticketTransfers, adminActivityLogs, downloads,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull, sql, inArray } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
