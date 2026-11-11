import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "./db";
import { appSettings, tickets, ticketMessages, users, adminActivityLogs, ticketNotifications, type Ticket, type TicketMessage } from "@shared/schema";
import { automatedClosureMessage, ticketAutoCloseSettingsSchema } from "@shared/ticket-auto-close";

export async function getTicketAutoCloseSettings(database = db) {
  await database.insert(appSettings).values({ id: "singleton" }).onConflictDoNothing();
  const [row] = await database.select().from(appSettings).where(eq(appSettings.id, "singleton"));
  return { enabled: row.ticketAutoCloseEnabled, days: row.ticketAutoCloseDays, message: row.ticketAutoCloseMessage };
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
    if (!parsed.success) return res.status(400).json({ message: "Choose 1–365 whole days and a message of 1–2,000 characters." });
    const { enabled, days, message } = parsed.data;
    try {
      await database.transaction(async tx => {
        await tx.insert(appSettings).values({ id: "singleton" }).onConflictDoNothing();
        await tx.update(appSettings).set({
          ticketAutoCloseEnabled: enabled, ticketAutoCloseDays: days, ticketAutoCloseMessage: message, updatedAt: new Date(),
        }).where(eq(appSettings.id, "singleton"));
        await tx.insert(adminActivityLogs).values({
          category: "system", action: "ticket_auto_close_settings_updated", actorId: req.session.userId,
          summary: `Automatic ticket closure ${enabled ? `enabled after ${days} days without communication` : "disabled"}`,
          details: JSON.stringify({ enabled, days, message }),
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

export function startTicketAutoClose(onClosed: (closure: Closure) => Promise<void>) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await closeInactiveTickets(onClosed); }
    catch (error) { console.error("Ticket inactivity sweep failed:", error); }
    finally { running = false; }
  };
  const timer = setInterval(() => void run(), 5 * 60_000);
  timer.unref();
  void run();
  return timer;
}
