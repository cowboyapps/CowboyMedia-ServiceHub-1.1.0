import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { db } from "./db";
import { appSettings, tickets, ticketMessages, users, adminActivityLogs, ticketNotifications, userNotifications, type Ticket, type TicketMessage, type User } from "@shared/schema";
import { automatedClosureMessage, ticketAutoCloseSettingsSchema } from "@shared/ticket-auto-close";
import { userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";
import { shouldSuppressNotification } from "@shared/quiet-hours";

export async function getTicketAutoCloseSettings(database = db) {
  await database.insert(appSettings).values({ id: "singleton" }).onConflictDoNothing();
  const [row] = await database.select().from(appSettings).where(eq(appSettings.id, "singleton"));
  return {
    enabled: row.ticketAutoCloseEnabled, days: row.ticketAutoCloseDays, message: row.ticketAutoCloseMessage,
    reminderEnabled: row.ticketAutoCloseReminderEnabled, reminderHoursBefore: row.ticketAutoCloseReminderHoursBefore,
  };
}

export function createTicketAutoCloseHandlers(database = db) { return {
  async get(_req: Request, res: Response) {
    try {
      res.set("Cache-Control", "no-store").json(await getTicketAutoCloseSettings(database));
    } catch {
      res.status(500).json({ message: "Unable to load ticket auto-close settings." });
    }
  },
  async patch(req: Request, res: Response) {
    const parsed = ticketAutoCloseSettingsSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.issues.map(issue => issue.message).join(" ") });
    const { enabled, days, message, reminderEnabled, reminderHoursBefore } = parsed.data;
    try {
      await database.transaction(async tx => {
        await tx.insert(appSettings).values({ id: "singleton" }).onConflictDoNothing();
        await tx.update(appSettings).set({
          ticketAutoCloseEnabled: enabled, ticketAutoCloseDays: days, ticketAutoCloseMessage: message, updatedAt: new Date(),
          ticketAutoCloseReminderEnabled: reminderEnabled, ticketAutoCloseReminderHoursBefore: reminderHoursBefore,
        }).where(eq(appSettings.id, "singleton"));
        await tx.insert(adminActivityLogs).values({
          category: "system", action: "ticket_auto_close_settings_updated", actorId: req.session.userId,
          summary: `Automatic ticket closure ${enabled ? `enabled after ${days} days without communication` : "disabled"}`,
          details: JSON.stringify(parsed.data),
        });
      });
      res.json(parsed.data);
    } catch {
      res.status(500).json({ message: "Unable to save ticket auto-close settings. Please try again." });
    }
  },
}; }

export const ticketAutoCloseHandlers = createTicketAutoCloseHandlers();

type Closure = { ticket: Ticket; message: TicketMessage };

export type InactivityReminder = {
  ticket: Ticket;
  customer: User;
  channel: "push" | "email";
  title: string;
  body: string;
  closesAt: Date;
  url: string;
};
type ReminderSender = (reminder: InactivityReminder) => Promise<void>;
const reminderMarkers = {
  in_app: "inactivityReminderInAppActivity",
  push: "inactivityReminderPushActivity",
  email: "inactivityReminderEmailActivity",
} as const;

/** Durable per-channel claims give at-most-once external delivery attempts per public-activity timestamp.
 * Quiet-hours channels remain unclaimed and can be sent on a later sweep, but never after the deadline.
 * Keyset pagination prevents already-reminded/quiet-hours tickets starving later tickets.
 */
export async function remindInactiveTickets(send: ReminderSender, onlyTicketId?: string, database = db) {
  const settings = await getTicketAutoCloseSettings(database);
  if (!settings.enabled || !settings.reminderEnabled) return 0;
  let cursor: string | undefined;
  let count = 0;
  while (true) {
    const candidates = await database.select({ id: tickets.id }).from(tickets).where(and(
      eq(tickets.status, "open"),
      lte(tickets.lastCommunicationAt, new Date(Date.now() - (settings.days * 24 - settings.reminderHoursBefore) * 3600000)),
      gt(tickets.lastCommunicationAt, new Date(Date.now() - settings.days * 86400000)),
      onlyTicketId ? eq(tickets.id, onlyTicketId) : undefined,
      cursor ? gt(tickets.id, cursor) : undefined,
    )).orderBy(tickets.id).limit(100);
    if (!candidates.length) break;
    for (const candidate of candidates) {
      const claim = await database.transaction(async tx => {
        const [policy] = await tx.select().from(appSettings).where(eq(appSettings.id, "singleton")).for("share");
        const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, candidate.id)).for("update", { skipLocked: true });
        const now = new Date();
        if (!ticket || !reminderIsDue(ticket, policy, now)) return;
        const [customer] = await tx.select().from(users).where(eq(users.id, ticket.customerId));
        if (!customer) return;
        const closesAt = new Date(ticket.lastCommunicationAt.getTime() + policy.ticketAutoCloseDays * 86400000);
        const title = "Your support ticket will close soon";
        const body = `Your ticket "${ticket.subject}" will automatically close due to inactivity on ${closesAt.toUTCString()}. Reply before then if you still need help.`;
        const url = `/tickets/${ticket.id}`;
        const external: ("push" | "email")[] = [];
        for (const channel of ["in_app", "push", "email"] as const) {
          const marker = reminderMarkers[channel];
          if (ticket[marker]?.getTime() === ticket.lastCommunicationAt.getTime()) continue;
          // Reuse reply preferences: this is a ticket update, not a closure/transcript email.
          if (!userWantsChannel(customer.notificationPrefs as NotificationPrefs | null, "ticket_reply", channel)) continue;
          if (channel === "email" && !customer.email) continue;
          if (channel !== "in_app" && shouldSuppressNotification({ user: customer, categoryKey: "ticket_reply", now })) continue;
          await tx.update(tickets).set({ [marker]: ticket.lastCommunicationAt }).where(eq(tickets.id, ticket.id));
          if (channel === "in_app") {
            await tx.insert(userNotifications).values({
              userId: customer.id, type: "ticket_update", title, body, referenceType: "ticket", referenceId: ticket.id, url,
            });
            await tx.insert(ticketNotifications).values({
              userId: customer.id, ticketId: ticket.id, type: "ticket_inactivity_reminder", message: body,
            });
          } else external.push(channel);
          count++;
        }
        return { ticket, customer, external, title, body, url, closesAt };
      });
      if (!claim?.external.length) continue;
      // Claims commit before network calls. Revalidate under the same locks as replies/closure,
      // so a reply or policy change winning the lock cancels this stale delivery.
      await database.transaction(async tx => {
        const [policy] = await tx.select().from(appSettings).where(eq(appSettings.id, "singleton")).for("share");
        const [current] = await tx.select().from(tickets).where(eq(tickets.id, candidate.id)).for("update");
        if (!current || current.lastCommunicationAt.getTime() !== claim.ticket.lastCommunicationAt.getTime() ||
            !reminderIsDue(current, policy, new Date())) return;
        const [customer] = await tx.select().from(users).where(eq(users.id, current.customerId));
        if (!customer) return;
        for (const channel of claim.external) {
          if (!userWantsChannel(customer.notificationPrefs as NotificationPrefs | null, "ticket_reply", channel) ||
              shouldSuppressNotification({ user: customer, categoryKey: "ticket_reply" }) ||
              (channel === "email" && !customer.email)) continue;
          if (!reminderIsDue(current, policy, new Date())) break;
          try { await send({ ...claim, customer, channel }); }
          catch (error) { console.error(`Ticket inactivity reminder ${channel} attempt failed for ${current.id}:`, error); }
        }
      });
    }
    cursor = candidates[candidates.length - 1].id;
  }
  return count;
}

function reminderIsDue(ticket: Ticket, policy: typeof appSettings.$inferSelect, now: Date) {
  const closesAt = ticket.lastCommunicationAt.getTime() + policy.ticketAutoCloseDays * 86400000;
  return policy.ticketAutoCloseEnabled && policy.ticketAutoCloseReminderEnabled &&
    policy.ticketAutoCloseReminderHoursBefore > 0 && policy.ticketAutoCloseReminderHoursBefore < policy.ticketAutoCloseDays * 24 &&
    ticket.status === "open" && now.getTime() < closesAt &&
    now.getTime() >= closesAt - policy.ticketAutoCloseReminderHoursBefore * 3600000;
}

/** Runs in bounded batches. Settings and ticket row locks serialize policy changes and new replies. */
export async function closeInactiveTickets(onClosed: (closure: Closure) => Promise<void> = async () => {}, onlyTicketId?: string, database = db) {
  const settings = await getTicketAutoCloseSettings(database);
  if (!settings.enabled) return 0;
  const candidates = await database.select({ id: tickets.id }).from(tickets).where(and(
    eq(tickets.status, "open"),
    lte(tickets.lastCommunicationAt, new Date(Date.now() - settings.days * 86400000)),
    onlyTicketId ? eq(tickets.id, onlyTicketId) : undefined,
  )).orderBy(tickets.lastCommunicationAt).limit(100);
  if (!candidates.length) return 0;
  await database.insert(users).values({
    username: "cowboymedia-support", password: randomBytes(64).toString("hex"),
    email: "noreply@cowboymedia.net", fullName: "CowboyMedia Support", role: "admin", theme: "light",
  }).onConflictDoNothing();
  const [sender] = await database.select({ id: users.id }).from(users).where(eq(users.username, "cowboymedia-support"));
  let count = 0;
  for (const candidate of candidates) {
    const closure = await database.transaction(async tx => {
      const [policy] = await tx.select().from(appSettings).where(eq(appSettings.id, "singleton")).for("share");
      if (!policy.ticketAutoCloseEnabled) return;
      const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, candidate.id)).for("update", { skipLocked: true });
      const now = new Date();
      if (!ticket || ticket.status !== "open" || ticket.lastCommunicationAt.getTime() > now.getTime() - policy.ticketAutoCloseDays * 86400000) return;
      const reason = `Automatically closed due to inactivity after ${policy.ticketAutoCloseDays} days without communication. Last communication: ${ticket.lastCommunicationAt.toISOString()}. Closed: ${now.toISOString()}.`;
      const [message] = await tx.insert(ticketMessages).values({
        ticketId: ticket.id, senderId: sender.id, message: automatedClosureMessage(policy.ticketAutoCloseMessage), isInternal: false,
      }).returning();
      const [closed] = await tx.update(tickets).set({
        status: "closed", closedAt: now, closedBy: sender.id,
        closureReason: "inactivity",
        // Preserve any earlier resolution context and the original activity timestamp.
        resolutionNote: [ticket.resolutionNote, reason, `Automated Message: ${policy.ticketAutoCloseMessage}`].filter(Boolean).join("\n\n"),
        lastCommunicationAt: ticket.lastCommunicationAt,
      }).where(eq(tickets.id, ticket.id)).returning();
      await tx.insert(adminActivityLogs).values({
        category: "ticket", action: "ticket_auto_closed", targetId: ticket.id, targetType: "ticket",
        summary: `Ticket automatically closed after ${policy.ticketAutoCloseDays} days of inactivity: "${ticket.subject}"`,
        details: JSON.stringify({ reason: "inactivity", days: policy.ticketAutoCloseDays, lastCommunicationAt: ticket.lastCommunicationAt, closedAt: now, message: policy.ticketAutoCloseMessage }),
      });
      await tx.insert(ticketNotifications).values({
        userId: ticket.customerId, ticketId: ticket.id, type: "ticket_closed",
        message: `Automated Message: Your ticket "${ticket.subject}" was closed due to inactivity.`,
      });
      return { ticket: closed, message };
    });
    if (closure) {
      count++;
      try { await onClosed(closure); }
      catch (error) { console.error("Ticket auto-close committed; notification failed:", error); }
    }
  }
  return count;
}

export function startTicketAutoClose(onClosed: (closure: Closure) => Promise<void>, onReminder: ReminderSender) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await closeInactiveTickets(onClosed);
      await remindInactiveTickets(onReminder);
    }
    catch (error) { console.error("Ticket inactivity sweep failed:", error); }
    finally { running = false; }
  };
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
  void run();
  return timer;
}
