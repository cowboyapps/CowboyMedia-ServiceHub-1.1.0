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
  users, services, serviceAlerts, alertUpdates, newsStories, tickets, ticketMessages, privateMessages, ticketNotifications, pushSubscriptions, quickResponses, reportRequests, reportNotifications,
} from "@shared/schema";
import { db } from "./db";
import { eq, desc, and, isNull, sql } from "drizzle-orm";

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
}

export const storage = new DatabaseStorage();
