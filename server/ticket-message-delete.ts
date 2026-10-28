import type { Request, Response } from "express";
import type { Ticket, TicketMessage, User } from "@shared/schema";
import { canMutateInternalNote, isAdminRole } from "./ticket-internal-notes";
import { getParam } from "./http-params";

export interface TicketMessageDeleteDeps {
  getUser(id: string): Promise<User | undefined>;
  getTicket(id: string): Promise<Ticket | undefined>;
  getMessage(id: string): Promise<TicketMessage | undefined>;
  canManage(actor: User, ticket: Ticket): Promise<boolean>;
  recipients(ticket: Ticket, internal: boolean): Promise<string[]>;
  /** Atomically delete the matching row and write a metadata-only audit entry. */
  remove(ticketId: string, messageId: string, actorId: string): Promise<TicketMessage | undefined>;
  cleanup(url: string | null): Promise<void>;
  broadcast(ids: string[], event: { type: string; ticketId: string; messageId: string }): void;
}

export function createTicketMessageDeleteHandler(deps: TicketMessageDeleteDeps) {
  return async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
      const actor = await deps.getUser(req.session.userId);
      if (!actor || !isAdminRole(actor.role)) return res.status(403).json({ message: "Admin access required" });
      const ticket = await deps.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const messageId = getParam(req, "messageId");
      const msg = await deps.getMessage(messageId);
      if (msg && msg.ticketId !== ticket.id) return res.status(404).json({ message: "Message not found" });
      if (msg?.isInternal) {
        const check = canMutateInternalNote(msg, ticket.id, actor);
        if (!check.ok) return res.status(check.status).json({ message: check.message });
      } else if (!await deps.canManage(actor, ticket)) {
        return res.status(403).json({ message: "You don't have permission to delete messages on this ticket" });
      }
      if (!msg) return res.json({ message: "Deleted", messageId });
      const ids = await deps.recipients(ticket, msg.isInternal);
      const removed = await deps.remove(ticket.id, messageId, actor.id);
      // Commit is authoritative. A cleanup/socket failure must not make the
      // client believe deletion failed; reconnect/refetch repairs missed events.
      try { deps.broadcast(ids, { type: "ticket_message_deleted", ticketId: ticket.id, messageId }); }
      catch { console.error("Ticket deletion broadcast failed"); }
      if (removed) {
        try { await deps.cleanup(removed.imageUrl); }
        catch { console.error("Ticket deletion attachment cleanup failed"); }
      }
      return res.json({ message: "Deleted", messageId });
    } catch {
      return res.status(500).json({ message: "Couldn't delete the message. Please try again." });
    }
  };
}
