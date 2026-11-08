import type { Request, Response } from "express";
import type { MessageThread, ThreadMessage, User } from "@shared/schema";
import { TICKET_REACTION_EMOJIS, type TicketReactionSummary } from "@shared/ticket-reactions";
import { getParam } from "./http-params";
import { canAccessThread, ThreadWriteError } from "./thread-messaging-storage";
import { storedThreadUploadSize, streamThreadUpload, type StoredThreadUpload } from "./thread-file-storage";

export interface ThreadMessagingDeps {
  getUser: (id: string) => Promise<User | undefined>;
  getThread: (id: string) => Promise<MessageThread | undefined>;
  getMessage: (id: string) => Promise<ThreadMessage | undefined>;
  canManage: (actor: User) => Promise<boolean>;
  edit: (threadId: string, id: string, actorId: string, body: string, original: string) => Promise<ThreadMessage>;
  remove: (threadId: string, id: string, actorId: string) => Promise<ThreadMessage>;
  react: (threadId: string, id: string, actorId: string, emoji: string | null) => Promise<void>;
  reactions: (ids: string[], actorId: string) => Promise<Record<string, TicketReactionSummary[]>>;
  markRead: (threadId: string, actorId: string, ids: string[]) => Promise<boolean>;
  getUpload: (filename: string) => Promise<StoredThreadUpload | undefined>;
  cleanup: (url: string) => Promise<unknown>;
  broadcast: (event: Record<string, unknown>, ids: string[]) => void;
}

export function createThreadMessagingHandlers(deps: ThreadMessagingDeps) {
  async function authorize(req: Request, res: Response) {
    res.set("Cache-Control", "no-store");
    const actor = req.session.userId ? await deps.getUser(req.session.userId) : undefined;
    if (!actor) { res.status(401).json({ message: "Unauthorized" }); return; }
    const thread = await deps.getThread(getParam(req, "id"));
    if (!thread) { res.status(404).json({ message: "Conversation not found" }); return; }
    if (!canAccessThread(actor, thread)) { res.status(403).json({ message: "Forbidden" }); return; }
    return { actor, thread };
  }
  function emit(thread: MessageThread, type: string, messageId?: string) {
    try { deps.broadcast({ type, threadId: thread.id, ...(messageId ? { messageId } : {}) }, [thread.adminId, thread.customerId]); }
    catch { console.error("Private-message update broadcast failed"); }
  }
  function failure(res: Response, error: unknown) {
    return res.status(error instanceof ThreadWriteError ? error.status : 500).json({
      message: error instanceof ThreadWriteError ? error.message : "Couldn't update this message. Please try again.",
    });
  }
  const edit = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      if (typeof req.body?.body !== "string" || typeof req.body?.originalBody !== "string" || req.body.body.length > 100000) {
        return res.status(400).json({ message: "Provide the edited message and its original text" });
      }
      const message = await deps.edit(auth.thread.id, getParam(req, "messageId"), auth.actor.id, req.body.body.trim(), req.body.originalBody);
      emit(auth.thread, "thread_message_edited", message.id);
      const { requestFingerprint: _fingerprint, ...publicMessage } = message;
      return res.json(publicMessage);
    } catch (error) { return failure(res, error); }
  };
  const remove = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      if (!await deps.canManage(auth.actor)) return res.status(403).json({ message: "Insufficient permissions" });
      const message = await deps.remove(auth.thread.id, getParam(req, "messageId"), auth.actor.id);
      emit(auth.thread, "thread_message_deleted", message.id);
      if (message.imageUrl) await deps.cleanup(message.imageUrl).catch(() => console.error("Private attachment cleanup failed"));
      return res.json({ messageId: message.id });
    } catch (error) { return failure(res, error); }
  };
  const reaction = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const emoji = req.body?.emoji;
      if (emoji !== null && (typeof emoji !== "string" || !TICKET_REACTION_EMOJIS.includes(emoji))) return res.status(400).json({ message: "Choose a supported reaction" });
      const id = getParam(req, "messageId");
      await deps.react(auth.thread.id, id, auth.actor.id, emoji);
      emit(auth.thread, "thread_reactions_updated", id);
      return res.json({ reactions: (await deps.reactions([id], auth.actor.id))[id] ?? [] });
    } catch (error) { return failure(res, error); }
  };
  const read = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const ids = req.body?.messageIds;
      if (!Array.isArray(ids) || ids.length > 100 || ids.some(id => typeof id !== "string" || !id || id.length > 100)) return res.status(400).json({ message: "Provide up to 100 visible message IDs" });
      // Supervisors can inspect a conversation without impersonating either
      // participant's read receipt.
      if (auth.actor.id !== auth.thread.adminId && auth.actor.id !== auth.thread.customerId) return res.json({ changed: false });
      const changed = await deps.markRead(auth.thread.id, auth.actor.id, [...new Set(ids)] as string[]);
      if (changed) {
        try { deps.broadcast({ type: "thread_messages_read", threadId: auth.thread.id, readBy: auth.actor.id }, [auth.thread.adminId, auth.thread.customerId]); }
        catch { console.error("Private read receipt broadcast failed"); }
      }
      return res.json({ changed });
    } catch (error) { return failure(res, error); }
  };
  const attachment = async (req: Request, res: Response) => {
    try {
      const auth = await authorize(req, res);
      if (!auth) return;
      const message = await deps.getMessage(getParam(req, "messageId"));
      if (!message || message.threadId !== auth.thread.id) return res.status(404).json({ message: "Message not found" });
      const filename = message.imageUrl?.match(/^\/uploads\/([^/?#]+)$/)?.[1];
      const file = filename ? await deps.getUpload(filename) : undefined;
      if (!file) return res.status(404).json({ message: "Attachment not found" });
      return await serveThreadAttachment(req, res, file, message.attachmentName || file.filename);
    } catch { if (!res.headersSent && !res.destroyed) return res.status(500).json({ message: "Couldn't load the attachment" }); }
  };
  return { edit, remove, reaction, read, attachment };
}

export async function serveThreadAttachment(req: Request, res: Response, file: StoredThreadUpload, name: string) {
  const size = storedThreadUploadSize(file);
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, "_") || "attachment";
  const safeInline = /^(image\/(?:png|jpeg|gif|webp|bmp)|video\/(?:mp4|webm|quicktime|x-m4v|x-msvideo|x-matroska))$/i.test(file.mimetype);
  res.set({
    "Cache-Control": "no-store", "Content-Type": file.mimetype,
    "X-Content-Type-Options": "nosniff", "Accept-Ranges": "bytes",
    "Content-Disposition": `${req.query.download === "1" || !safeInline ? "attachment" : "inline"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(name).replace(/'/g, "%27")}`,
  });
  if (!safeInline) res.set("Content-Security-Policy", "sandbox; default-src 'none'");
  const range = req.headers.range;
  if (range) {
    const parsed = /^bytes=(\d*)-(\d*)$/.exec(range);
    const suffix = parsed && !parsed[1] ? Number(parsed[2]) : null;
    const start = suffix !== null ? Math.max(0, size - suffix) : Number(parsed?.[1] ?? -1);
    const end = suffix !== null ? size - 1 : parsed?.[2] ? Math.min(Number(parsed[2]), size - 1) : size - 1;
    if (!parsed || (!parsed[1] && !parsed[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size || suffix === 0) {
      return res.set("Content-Range", `bytes */${size}`).status(416).end();
    }
    res.set({ "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) }).status(206);
    if (req.method === "HEAD") return res.end();
    return streamThreadUpload(file, start, end, res);
  }
  res.set("Content-Length", String(size));
  if (req.method === "HEAD" || !size) return res.end();
  return streamThreadUpload(file, 0, size - 1, res);
}
