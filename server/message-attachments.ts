import {
  resolveKbArticleAttachment,
  type CommunityChatKbStorage,
  type KbArticleEnvelope,
} from "./community-chat-kb";

export type ResolveKbAttachmentForSenderResult =
  | { ok: true; kbArticleSlug: string | null; kbArticleInfo: KbArticleEnvelope | null }
  | { ok: false; status: number; error: string };

// Enforces the message-thread KB-linking rule and resolves the article BEFORE
// any uploaded file is persisted. Two security properties live here:
//   1. Only admins may attach a KB article. A non-admin slug attempt is
//      rejected with 403 and the caller must NOT persist the upload.
//   2. An unknown/unpublished slug is rejected with the resolver's status
//      (400) and, again, the caller must NOT persist the upload.
// Callers run this and bail on `!ok` before calling saveUploadedFile so a
// rejected request never leaves an orphaned file blob behind.
export async function resolveKbAttachmentForSender(
  input: { rawKbSlug: string; isAdminSending: boolean },
  storage: CommunityChatKbStorage,
): Promise<ResolveKbAttachmentForSenderResult> {
  const slug = input.rawKbSlug.trim();
  if (slug.length === 0) {
    return { ok: true, kbArticleSlug: null, kbArticleInfo: null };
  }
  if (!input.isAdminSending) {
    return { ok: false, status: 403, error: "Only admins can link knowledge base articles" };
  }
  const resolved = await resolveKbArticleAttachment(slug, storage);
  if (!resolved.ok) {
    return { ok: false, status: resolved.status, error: resolved.error };
  }
  return { ok: true, kbArticleSlug: resolved.slug, kbArticleInfo: resolved.info };
}
