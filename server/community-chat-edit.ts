// Pure guard logic + real route handlers for editing community chat messages
// and reading their edit history — extracted (with injected deps, same pattern
// as server/require-permission.ts) so the ACTUAL route behavior is testable
// without booting the whole app.

import type { Request, Response } from "express";
import { getParam } from "./http-params";
import { getErrorMessage } from "./error-utils";

export const COMMUNITY_EDIT_WINDOW_MS = 15 * 60 * 1000;

export interface EditGuardInput {
  message: { userId: string; createdAt: Date; pollId: string | null } | undefined;
  requesterId: string;
  isAdmin: boolean;
  newContent: string;
  hasImage: boolean;
  hasKbArticle: boolean;
  now?: Date;
}

export type EditGuardResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function checkCommunityMessageEdit(input: EditGuardInput): EditGuardResult {
  const { message, requesterId, isAdmin, newContent, hasImage, hasKbArticle } = input;
  const now = input.now ?? new Date();
  if (!message) {
    return { ok: false, status: 404, error: "Message not found" };
  }
  if (message.pollId) {
    return { ok: false, status: 400, error: "Poll messages cannot be edited" };
  }
  if (!isAdmin && message.userId !== requesterId) {
    return { ok: false, status: 403, error: "You can only edit your own messages" };
  }
  if (!isAdmin && now.getTime() - message.createdAt.getTime() > COMMUNITY_EDIT_WINDOW_MS) {
    return { ok: false, status: 403, error: "Messages can only be edited within 15 minutes of posting" };
  }
  // Image-only / KB-only messages may have empty text; otherwise text required.
  if (!newContent.trim() && !hasImage && !hasKbArticle) {
    return { ok: false, status: 400, error: "Content is required" };
  }
  if (newContent.length > 2000) {
    return { ok: false, status: 400, error: "Message too long (max 2000 characters)" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Real route handlers (dependency-injected). server/routes.ts registers these
// behind requireAuth; tests exercise the same code with stub deps.
// ---------------------------------------------------------------------------

export interface CommunityEditUser {
  id: string;
  role: string;
  username: string;
  chatUsername: string | null;
  chatBanned: boolean | null;
}

export interface CommunityEditMessage {
  id: string;
  userId: string;
  content: string;
  imageUrl: string | null;
  kbArticleSlug: string | null;
  pollId: string | null;
  createdAt: Date;
  editedAt: Date | null;
}

export interface CommunityEditDeps {
  getUser(id: string): Promise<CommunityEditUser | undefined>;
  getCommunityMessage(id: string): Promise<CommunityEditMessage | undefined>;
  getAllWordFilters(): Promise<Array<{ word: string }>>;
  updateCommunityMessageContent(id: string, content: string, editedAt: Date): Promise<CommunityEditMessage | undefined>;
  recordCommunityMessageEdit(edit: {
    messageId: string;
    previousContent: string;
    editedBy: string;
    editedByUsername: string;
  }): Promise<unknown>;
  getCommunityMessageEditHistory(messageId: string): Promise<unknown[]>;
  broadcast(data: unknown): void;
}

// PATCH /api/community-chat/messages/:id — author-only within a 15-minute
// window; admins may edit any message at any time. Word filter and @everyone
// gating re-apply. Records a prior-version history row ONLY when the text
// actually changed (best-effort — a history hiccup must not fail the edit).
export function createCommunityMessageEditHandler(deps: CommunityEditDeps) {
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (user.chatBanned) {
        return res.status(403).json({ error: "You have been banned from community chat" });
      }
      const isAdminUser = user.role === "admin" || user.role === "master_admin";
      const existing = await deps.getCommunityMessage(getParam(req, "id"));
      const rawContent = typeof req.body?.content === "string" ? req.body.content : "";
      const guard = checkCommunityMessageEdit({
        message: existing,
        requesterId: user.id,
        isAdmin: isAdminUser,
        newContent: rawContent,
        hasImage: !!existing?.imageUrl,
        hasKbArticle: !!existing?.kbArticleSlug,
      });
      if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

      let trimmedContent = rawContent.trim();
      const hasEveryone = /@everyone\b/i.test(trimmedContent);
      if (hasEveryone && !isAdminUser) {
        return res.status(403).json({ error: "Only admins can use @everyone" });
      }
      const wordFilters = await deps.getAllWordFilters();
      for (const filter of wordFilters) {
        const pattern = new RegExp(filter.word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        trimmedContent = trimmedContent.replace(pattern, (match: string) => {
          if (match.length <= 3) return match[0] + "*".repeat(match.length - 1);
          return match[0] + "*".repeat(match.length - 2) + match[match.length - 1];
        });
      }

      const editedAt = new Date();
      const updated = await deps.updateCommunityMessageContent(getParam(req, "id"), trimmedContent, editedAt);
      if (!updated) return res.status(404).json({ error: "Message not found" });
      // Preserve the wording that was just replaced so admins can review the
      // full edit history. Only record when the text actually changed;
      // best-effort — a history hiccup must not fail the edit itself.
      let historyRecorded = false;
      if (existing && existing.content !== trimmedContent) {
        try {
          await deps.recordCommunityMessageEdit({
            messageId: updated.id,
            previousContent: existing.content,
            editedBy: user.id,
            editedByUsername: user.chatUsername || user.username,
          });
          historyRecorded = true;
        } catch (histErr) {
          console.error("Community chat edit-history record error:", histErr);
        }
      }
      deps.broadcast({
        type: "community_message_edited",
        messageId: updated.id,
        content: updated.content,
        editedAt: updated.editedAt,
        // Only flips clients to "history exists" when a row was actually
        // written; omitted/false leaves their existing flag untouched.
        hasEditHistory: historyRecorded || undefined,
      });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  };
}

// GET /api/community-chat/messages/:id/history — full prior-version history
// of an edited message. Admin-only (moderation tooling, never exposed to
// regular members); the 403 fires BEFORE the message lookup so customers get
// no existence oracle.
export function createCommunityMessageHistoryHandler(deps: CommunityEditDeps) {
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ error: "User not found" });
      const isAdminUser = user.role === "admin" || user.role === "master_admin";
      if (!isAdminUser) return res.status(403).json({ error: "Only admins can view edit history" });
      const message = await deps.getCommunityMessage(getParam(req, "id"));
      if (!message) return res.status(404).json({ error: "Message not found" });
      const edits = await deps.getCommunityMessageEditHistory(message.id);
      res.json({
        current: { content: message.content, editedAt: message.editedAt },
        edits,
      });
    } catch (e) {
      res.status(500).json({ error: getErrorMessage(e) });
    }
  };
}
