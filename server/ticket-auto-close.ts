import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, gt, lte, desc, isNull, or } from "drizzle-orm";
import { db } from "./db";
import { appSettings, tickets, ticketMessages, users, adminActivityLogs, ticketNotifications, userNotifications, ticketReminderAttempts, type Ticket, type TicketMessage, type User } from "@shared/schema";
import { rejectedReminderDelivery, type ReminderDeliveryResult } from "@shared/reminder-delivery";
import { automatedClosureMessage, hasActiveAutoCloseHold, ticketAutoCloseSettingsSchema } from "@shared/ticket-auto-close";
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
  async history(req: Request, res: Response) {
    try {
      const id = req.params.id;
      if (typeof id !== "string") return res.status(400).json({ message: "Invalid ticket." });
      const [ticket] = await database.select({ id: tickets.id }).from(tickets).where(eq(tickets.id, id));
      if (!ticket) return res.status(404).json({ message: "Ticket not found." });
      const history = await database.select().from(ticketReminderAttempts)
        .where(eq(ticketReminderAttempts.ticketId, id))
        .orderBy(desc(ticketReminderAttempts.attemptedAt), desc(ticketReminderAttempts.id)).limit(100);
      res.set("Cache-Control", "no-store").json(history);
    } catch {
      res.status(500).json({ message: "Unable to load reminder delivery history." });
    }
  },
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
type ReminderSender = (reminder: InactivityReminder) => Promise<ReminderDeliveryResult | void>;
const reminderMarkers = {
  in_app: "inactivityReminderInAppActivity",
  push: "inactivityReminderPushActivity",
  email: "inactivityReminderEmailActivity",
} as const;

/** Durable claims precede network calls. Only confirmed rate-limit rejections
 * retry (up to three attempts, with backoff). Unknown outcomes never retry:
 * SendGrid and Web Push have no delivery idempotency key. Success to even one
 * push device consumes that channel, preventing duplicate device notifications.
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
        const external: { channel: "push" | "email"; id: string; attempt: number }[] = [];
        for (const channel of ["in_app", "push", "email"] as const) {
          const marker = reminderMarkers[channel];
          const [previous] = channel === "in_app" ? [] : await tx.select().from(ticketReminderAttempts).where(and(
            eq(ticketReminderAttempts.ticketId, ticket.id),
            eq(ticketReminderAttempts.activityAt, ticket.lastCommunicationAt),
            eq(ticketReminderAttempts.channel, channel),
          )).orderBy(desc(ticketReminderAttempts.attempt)).limit(1);
          if (previous) {
            if (previous.status !== "failed" || !previous.retryable || previous.attempt >= 3 ||
                !previous.retryAt || previous.retryAt > now) continue;
          } else if (ticket[marker]?.getTime() === ticket.lastCommunicationAt.getTime()) {
            // Legacy claims may have reached the provider. Never replay them.
            continue;
          }
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
            await tx.insert(ticketReminderAttempts).values({
              ticketId: ticket.id, activityAt: ticket.lastCommunicationAt, channel, attempt: 1,
              status: "succeeded", detail: "In-app reminder saved. This does not confirm the customer read it.", finishedAt: now,
            });
          } else {
            const [attempt] = await tx.insert(ticketReminderAttempts).values({
              ticketId: ticket.id, activityAt: ticket.lastCommunicationAt, channel, attempt: (previous?.attempt ?? 0) + 1,
            }).returning();
            external.push({ channel, id: attempt.id, attempt: attempt.attempt });
          }
          count++;
        }
        return { ticket, customer, external, title, body, url, closesAt };
      });
      if (!claim?.external.length) continue;
      // Claims commit before network calls. Revalidate under the same locks as replies/closure,
      // so a reply or policy change winning the lock cancels this stale delivery.
      for (const attempt of claim.external) await database.transaction(async tx => {
        const [policy] = await tx.select().from(appSettings).where(eq(appSettings.id, "singleton")).for("share");
        const [current] = await tx.select().from(tickets).where(eq(tickets.id, candidate.id)).for("update");
        const cancel = async (detail: string) => {
          await tx.update(ticketReminderAttempts).set({
            status: "failed", detail, finishedAt: new Date(), retryable: false, retryAt: null,
          }).where(eq(ticketReminderAttempts.id, attempt.id));
        };
        if (!current || current.lastCommunicationAt.getTime() !== claim.ticket.lastCommunicationAt.getTime() ||
            !reminderIsDue(current, policy, new Date())) {
          await cancel("Not sent: ticket activity, deadline, status or reminder policy changed after claim.");
          return;
        }
        const [customer] = await tx.select().from(users).where(eq(users.id, current.customerId));
        if (!customer) {
          await cancel("Not sent: customer no longer exists.");
          return;
        }
        const { channel } = attempt;
        if (!userWantsChannel(customer.notificationPrefs as NotificationPrefs | null, "ticket_reply", channel) ||
            shouldSuppressNotification({ user: customer, categoryKey: "ticket_reply" }) ||
            (channel === "email" && !customer.email)) {
          await cancel("Not sent: customer preferences, quiet hours or contact details changed after claim.");
          return;
        }
        if (!reminderIsDue(current, policy, new Date())) {
          await cancel("Not sent: reminder window expired before sending.");
          return;
        }
        let outcome: ReminderDeliveryResult;
        try {
          outcome = await send({ ...claim, customer, channel }) ??
            rejectedReminderDelivery();
        } catch {
          outcome = rejectedReminderDelivery();
        }
        const retryable = outcome.status === "failed" && outcome.retryable && attempt.attempt < 3;
        await tx.update(ticketReminderAttempts).set({
          status: outcome.status, detail: outcome.detail, finishedAt: new Date(), retryable,
          retryAt: retryable ? new Date(Date.now() + attempt.attempt * 5 * 60_000) : null,
        }).where(eq(ticketReminderAttempts.id, attempt.id));
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
    ticket.status === "open" && !hasActiveAutoCloseHold(ticket, now) && now.getTime() < closesAt &&
    now.getTime() >= closesAt - policy.ticketAutoCloseReminderHoursBefore * 3600000;
}

/** Runs in bounded batches. Settings and ticket row locks serialize policy changes and new replies. */
export async function closeInactiveTickets(onClosed: (closure: Closure) => Promise<void> = async () => {}, onlyTicketId?: string, database = db) {
  const settings = await getTicketAutoCloseSettings(database);
  if (!settings.enabled) return 0;
  const candidates = await database.select({ id: tickets.id }).from(tickets).where(and(
    eq(tickets.status, "open"),
    // Filter before LIMIT so long-held tickets cannot starve other stale tickets.
    or(isNull(tickets.autoCloseHoldReason), lte(tickets.autoCloseHoldUntil, new Date())),
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
      if (!ticket || ticket.status !== "open" || hasActiveAutoCloseHold(ticket, now) || ticket.lastCommunicationAt.getTime() > now.getTime() - policy.ticketAutoCloseDays * 86400000) return;
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
