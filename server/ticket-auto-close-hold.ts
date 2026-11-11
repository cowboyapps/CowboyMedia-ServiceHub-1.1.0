import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { tickets, adminActivityLogs, type Ticket, type User } from "@shared/schema";
import { ticketAutoCloseHoldSchema } from "@shared/ticket-auto-close";
import { db } from "./db";

type Dependencies = {
  getUser: (id: string) => Promise<User | undefined>;
  canAccess: (actor: User, ticket: Ticket) => Promise<boolean>;
  onUpdated: (ticketId: string) => void;
};

/** Share the ticket row lock with replies and the inactivity sweep; audit and hold commit together. */
export function createTicketAutoCloseHoldHandler(deps: Dependencies, database = db) {
  return async (req: Request, res: Response) => {
    const parsed = ticketAutoCloseHoldSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Enter a reason of 1–2,000 characters and an optional valid expiry." });
    try {
      const actor = await deps.getUser(req.session.userId!);
      if (!actor || !["admin", "master_admin"].includes(actor.role)) {
        return res.status(403).json({ message: "Only authorized admins can manage inactivity holds." });
      }
      const id = req.params.id;
      if (typeof id !== "string") return res.status(400).json({ message: "Invalid ticket." });
      const result = await database.transaction(async tx => {
        const [ticket] = await tx.select().from(tickets).where(eq(tickets.id, id)).for("update");
        if (!ticket) return { status: 404, message: "Ticket not found." };
        if (!await deps.canAccess(actor, ticket)) return { status: 403, message: "You don't have access to this ticket." };
        if (ticket.status !== "open") return { status: 409, message: "This ticket is closed. Reopen it before changing its inactivity hold." };
        const now = new Date();
        const input = parsed.data;
        const expiresAt = input.enabled && input.expiresAt ? new Date(input.expiresAt) : null;
        if (expiresAt && expiresAt.getTime() <= now.getTime()) return { status: 400, message: "Choose an expiry in the future." };
        const changes = {
          autoCloseHoldReason: input.enabled ? input.reason : null,
          autoCloseHoldUntil: expiresAt,
          autoCloseHoldBy: input.enabled ? actor.id : null,
          autoCloseHoldAt: input.enabled ? now : null,
        };
        const [updated] = await tx.update(tickets).set(changes).where(eq(tickets.id, id)).returning();
        await tx.insert(adminActivityLogs).values({
          category: "ticket", action: input.enabled ? "ticket_auto_close_hold_set" : "ticket_auto_close_hold_removed",
          actorId: actor.id, targetId: id, targetType: "ticket",
          summary: `Inactivity hold ${input.enabled ? "set" : "removed"} by ${actor.fullName}: "${ticket.subject}"`,
          details: JSON.stringify({
            previous: { reason: ticket.autoCloseHoldReason, expiresAt: ticket.autoCloseHoldUntil, actorId: ticket.autoCloseHoldBy, setAt: ticket.autoCloseHoldAt },
            current: { reason: changes.autoCloseHoldReason, expiresAt, actorId: changes.autoCloseHoldBy, setAt: changes.autoCloseHoldAt },
            changedAt: now,
          }),
        });
        return { ticket: updated };
      });
      if (result.status !== undefined) return res.status(result.status).json({ message: result.message });
      // A broadcast failure must not report a committed hold as unsaved.
      try { deps.onUpdated(result.ticket.id); } catch (error) { console.error("Ticket hold broadcast failed:", error); }
      return res.json(result.ticket);
    } catch (error) {
      console.error("Ticket inactivity hold update failed:", error);
      return res.status(500).json({ message: "Unable to save the inactivity hold. Please try again." });
    }
  };
}
