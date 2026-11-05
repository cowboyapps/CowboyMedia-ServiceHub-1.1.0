import type { Request, Response } from "express";
import type { Ticket, TicketMessage, User } from "@shared/schema";
import { TICKET_REACTION_EMOJIS, type TicketReactionSummary } from "@shared/ticket-reactions";
import { getParam } from "./http-params";

export interface TicketMessagingDeps {
  getUser: (id: string) => Promise<User | undefined>;
  getTicket: (id: string) => Promise<Ticket | undefined>;
  getMessage: (id: string) => Promise<TicketMessage | undefined>;
  canAccess: (actor: User, ticket: Ticket) => Promise<boolean>;
  recipients: (ticket: Ticket) => Promise<string[]>;
  setReaction: (ticketId: string, messageId: string, actorId: string, emoji: string | null) => Promise<boolean>;
  reactions: (ids: string[], actorId: string) => Promise<Record<string, TicketReactionSummary[]>>;
  markRead: (ticket: Ticket, actor: User, ids: string[]) => Promise<boolean>;
  getUpload: (filename: string) => Promise<{ mimetype: string; data: string; filename: string } | undefined>;
  broadcast: (ids: string[], event: Record<string, unknown>) => void;
}

export function createTicketMessagingHandlers(deps: TicketMessagingDeps) {
  async function authorize(req: Request, res: Response) {
    res.set("Cache-Control", "no-store");
    if (!req.session.userId) { res.status(401).json({ message: "Unauthorized" }); return; }
    const actor = await deps.getUser(req.session.userId);
    if (!actor) { res.status(401).json({ message: "Unauthorized" }); return; }
    const ticket = await deps.getTicket(getParam(req, "id"));
    if (!ticket) { res.status(404).json({ message: "Ticket not found" }); return; }
    if (!await deps.canAccess(actor, ticket)) { res.status(403).json({ message: "No access to this ticket" }); return; }
    return { actor, ticket };
  }
  async function regularMessage(req: Request, res: Response, ticket: Ticket) {
    const message = await deps.getMessage(getParam(req, "messageId"));
    if (!message || message.ticketId !== ticket.id || message.isInternal) {
      res.status(404).json({ message: "Message not found" }); return;
    }
    return message;
  }
  function emit(ids: string[], event: Record<string, unknown>) {
    try { deps.broadcast(ids, event); } catch { console.error("Ticket messaging broadcast failed"); }
  }
  const reaction = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const emoji: unknown = req.body?.emoji;
      if (emoji !== null && (typeof emoji !== "string" || !TICKET_REACTION_EMOJIS.includes(emoji))) {
        return res.status(400).json({ message: "Choose a supported reaction" });
      }
      const message = await regularMessage(req, res, auth.ticket);
      if (!message) return;
      const recipients = await deps.recipients(auth.ticket);
      if (!await deps.setReaction(auth.ticket.id, message.id, auth.actor.id, emoji as string | null)) {
        return res.status(404).json({ message: "Message not found" });
      }
      emit(recipients, { type: "ticket_reactions_updated", ticketId: auth.ticket.id, messageId: message.id });
      const summary = await deps.reactions([message.id], auth.actor.id);
      return res.json({ reactions: summary[message.id] ?? [] });
    } catch { return res.status(500).json({ message: "Couldn't update the reaction. Please try again." }); }
  };
  const read = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const ids: unknown = req.body?.messageIds;
      if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || !id || id.length > 100)) {
        return res.status(400).json({ message: "Provide up to 100 visible message IDs" });
      }
      const recipients = await deps.recipients(auth.ticket);
      const changed = await deps.markRead(auth.ticket, auth.actor, [...new Set(ids as string[])]);
      if (changed) emit(recipients, { type: "ticket_messages_read", ticketId: auth.ticket.id, readBy: auth.actor.id });
      return res.json({ changed });
    } catch { return res.status(500).json({ message: "Couldn't update read status" }); }
  };
  const attachment = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const message = await regularMessage(req, res, auth.ticket);
      if (!message) return;
      // Only stored uploads associated with this exact message; never proxy a
      // client-supplied URL, KB resource, or another ticket's file.
      const match = message.imageUrl?.match(/^\/uploads\/([^/?#]+)$/);
      if (!match) return res.status(404).json({ message: "Attachment not found" });
      const file = await deps.getUpload(match[1]);
      if (!file) return res.status(404).json({ message: "Attachment not found" });
      const bytes = Buffer.from(file.data, "base64");
      const safeName = file.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const download = req.query.download === "1";
      const safeInline = /^(image\/(?:png|jpeg|gif|webp|bmp)|video\/(?:mp4|webm|quicktime|x-m4v|x-msvideo|x-matroska))$/i.test(file.mimetype);
      res.set({
        "Content-Type": file.mimetype,
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `${download || !safeInline ? "attachment" : "inline"}; filename="${safeName}"`,
        "Accept-Ranges": "bytes",
      });
      if (!safeInline) res.set("Content-Security-Policy", "sandbox; default-src 'none'");
      const range = req.headers.range;
      if (range) {
        const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
        const suffix = parsed && !parsed[1] ? Number(parsed[2]) : null;
        const start = suffix !== null ? Math.max(0, bytes.length - suffix) : Number(parsed?.[1] ?? -1);
        const end = suffix !== null ? bytes.length - 1 : parsed?.[2] ? Math.min(Number(parsed[2]), bytes.length - 1) : bytes.length - 1;
        if (!parsed || (!parsed[1] && !parsed[2]) || !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) || start < 0 || end < start || start >= bytes.length || suffix === 0) {
          res.set("Content-Range", `bytes */${bytes.length}`);
          return res.status(416).end();
        }
        res.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        res.set("Content-Length", String(end - start + 1));
        return res.status(206).send(bytes.subarray(start, end + 1));
      }
      res.set("Content-Length", String(bytes.length));
      return res.send(bytes);
    } catch { return res.status(500).json({ message: "Couldn't load the attachment" }); }
  };
  return { reaction, read, attachment };
}
