// Pure guard logic for editing community chat messages — extracted so route
// behavior is unit-testable without HTTP.

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
