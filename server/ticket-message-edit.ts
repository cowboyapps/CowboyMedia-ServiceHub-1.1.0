import type { Request, Response } from "express";
import type { TicketMessage } from "@shared/schema";
import type { TicketMessageDeleteDeps } from "./ticket-message-delete";
import { canMutateInternalNote, isAdminRole } from "./ticket-internal-notes";
import { getParam } from "./http-params";

type Deps = Pick<TicketMessageDeleteDeps, "getUser" | "getTicket" | "getMessage" | "canManage" | "recipients"> & {
  save(ticketId: string, messageId: string, actorId: string, text: string, original?: string): Promise<TicketMessage | undefined>;
  broadcast(ids: string[], event: { type: string; ticketId: string; message: TicketMessage; isInternal: boolean }): void;
};

export function createTicketMessageEditHandler(deps: Deps) {
  return async (req: Request, res: Response) => {
    try {
      if (!req.session.userId) return res.status(401).json({ message: "Unauthorized" });
      const actor = await deps.getUser(req.session.userId);
      if (!actor || !isAdminRole(actor.role)) return res.status(403).json({ message: "Admin access required" });
      const ticket = await deps.getTicket(getParam(req, "id"));
      if (!ticket) return res.status(404).json({ message: "Ticket not found" });
      const msg = await deps.getMessage(getParam(req, "messageId"));
      if (!msg || msg.ticketId !== ticket.id) return res.status(404).json({ message: "Message not found" });
      if (msg.isInternal) {
        const check = canMutateInternalNote(msg, ticket.id, actor);
        if (!check.ok) return res.status(check.status).json({ message: check.message });
      } else {
        if (msg.senderId !== actor.id) return res.status(403).json({ message: "You can only edit your own sent replies" });
        if (!await deps.canManage(actor, ticket)) return res.status(403).json({ message: "You don't have permission to edit messages on this ticket" });
      }
      if (typeof req.body?.message !== "string") return res.status(400).json({ message: "Message must be text" });
      const original = req.body.originalMessage;
      if (original !== undefined && typeof original !== "string") return res.status(400).json({ message: "Original message must be text" });
      if (original !== undefined && original !== msg.message) {
        return res.status(409).json({ message: "This message has changed. Close and reopen the editor to review the latest version." });
      }
      const text = req.body.message.trim();
      if (!text && (msg.isInternal || (!msg.imageUrl && !msg.kbArticleSlug))) {
        return res.status(400).json({ message: "Message cannot be empty" });
      }
      const ids = await deps.recipients(ticket, msg.isInternal);
      const updated = await deps.save(ticket.id, msg.id, actor.id, text, original);
      if (!updated) {
        const current = await deps.getMessage(msg.id);
        return res.status(current ? 409 : 404).json({ message: current
          ? "This message has changed. Close and reopen the editor to review the latest version."
          : "Message no longer available" });
      }
      try {
        deps.broadcast(ids, { type: "ticket_message_edited", ticketId: ticket.id, message: updated, isInternal: updated.isInternal });
      } catch {
        // The save has committed. Polling/reconnect repairs a missed event.
        console.error("Ticket message edit broadcast failed");
      }
      return res.json(updated);
    } catch {
      return res.status(500).json({ message: "Couldn't edit the message. Please try again." });
    }
  };
}
