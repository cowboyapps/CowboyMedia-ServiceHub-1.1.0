import { eq, like } from "drizzle-orm";
import { db } from "./db";
import {
  uploadedFiles,
  users,
  serviceAlerts,
  alertUpdates,
  newsStories,
  tickets,
  ticketMessages,
  reportRequests,
  adminChatMessages,
  downloads,
  threadMessages,
  communityMessages,
  kbArticles,
  announcements,
  changelogEntries,
} from "@shared/schema";

// Pulls the bare filename out of a `/uploads/<filename>` URL. Returns null for
// anything that isn't a locally-hosted upload (external URLs, empty values,
// nested paths, query-string mangled paths, traversal attempts) so callers
// never act on a file we don't own.
export function extractUploadFilename(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = /^\/uploads\/([^/?#]+)$/.exec(url);
  return match ? match[1] : null;
}

// True when `url` (an `/uploads/<filename>` path) appears anywhere inside a
// rich-text HTML body. The shared rich-text editor (news, KB, announcements,
// changelog) embeds inline images as `<img src="/uploads/<uuid>...">`, so the
// exact `/uploads/<uuid>` path is present as a substring of the stored HTML.
// A plain substring test is the correct (and cheapest) reference check for
// these columns — single-URL `eq` checks would miss them entirely.
export function bodyHtmlReferencesUpload(body: string | null | undefined, url: string): boolean {
  if (!body) return false;
  return body.includes(url);
}

// Builds a Postgres LIKE pattern that matches rows whose body contains `url` as
// a substring. Escapes LIKE wildcards (`%`, `_`, `\`) so a filename can never be
// interpreted as a pattern (Postgres uses `\` as the default LIKE escape char).
function uploadLikePattern(url: string): string {
  const escaped = url.replace(/([\\%_])/g, "\\$1");
  return `%${escaped}%`;
}

// Every table/column that can persist an `/uploads/...` URL. Keep this in sync
// whenever a new column starts storing uploaded-file references, otherwise the
// safety check could delete a file that's still in use. Two flavours:
//   - single-URL columns (avatars, cover images, attachments) → exact `eq`.
//   - rich-text HTML bodies that can embed inline editor images → substring
//     `like`, because the `/uploads/...` path lives inside the HTML, not in its
//     own column. Missing these is exactly what wiped in-article KB images.
const referenceChecks: Array<(url: string) => Promise<boolean>> = [
  async (url) => (await db.select({ id: users.id }).from(users).where(eq(users.avatarUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: serviceAlerts.id }).from(serviceAlerts).where(eq(serviceAlerts.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: alertUpdates.id }).from(alertUpdates).where(eq(alertUpdates.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: newsStories.id }).from(newsStories).where(eq(newsStories.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: tickets.id }).from(tickets).where(eq(tickets.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: ticketMessages.id }).from(ticketMessages).where(eq(ticketMessages.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: reportRequests.id }).from(reportRequests).where(eq(reportRequests.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: adminChatMessages.id }).from(adminChatMessages).where(eq(adminChatMessages.fileUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: downloads.id }).from(downloads).where(eq(downloads.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: threadMessages.id }).from(threadMessages).where(eq(threadMessages.imageUrl, url)).limit(1)).length > 0,
  async (url) => (await db.select({ id: communityMessages.id }).from(communityMessages).where(eq(communityMessages.imageUrl, url)).limit(1)).length > 0,
  // Rich-text HTML bodies with inline editor images (substring match):
  async (url) => (await db.select({ id: newsStories.id }).from(newsStories).where(like(newsStories.content, uploadLikePattern(url))).limit(1)).length > 0,
  async (url) => (await db.select({ id: kbArticles.id }).from(kbArticles).where(like(kbArticles.bodyHtml, uploadLikePattern(url))).limit(1)).length > 0,
  async (url) => (await db.select({ id: announcements.id }).from(announcements).where(like(announcements.bodyHtml, uploadLikePattern(url))).limit(1)).length > 0,
  async (url) => (await db.select({ version: changelogEntries.version }).from(changelogEntries).where(like(changelogEntries.bodyHtml, uploadLikePattern(url))).limit(1)).length > 0,
];

// True when any record still points at `url`.
export async function isUploadReferenced(url: string): Promise<boolean> {
  const results = await Promise.all(referenceChecks.map((check) => check(url)));
  return results.some(Boolean);
}

// Injectable seams so the deletion decision can be tested without a live DB.
export interface CleanupDeps {
  isReferenced?: (url: string) => Promise<boolean>;
  remove?: (filename: string) => Promise<void>;
}

// Deletes the uploaded-file blob backing `url`, but ONLY when no other record
// still points at it. Call this AFTER the owning record has been removed so its
// own reference doesn't keep the file alive. Best-effort: never throws, so a
// cleanup failure can't break the user-facing delete it follows.
export async function deleteUploadedFileIfUnreferenced(
  url: string | null | undefined,
  deps: CleanupDeps = {},
): Promise<void> {
  const isReferenced = deps.isReferenced ?? isUploadReferenced;
  const remove =
    deps.remove ??
    (async (filename: string) => {
      await db.delete(uploadedFiles).where(eq(uploadedFiles.filename, filename));
    });
  try {
    const filename = extractUploadFilename(url);
    if (!filename) return;
    if (await isReferenced(url!)) return;
    await remove(filename);
  } catch (e) {
    console.error("deleteUploadedFileIfUnreferenced failed:", e);
  }
}

// Injectable seams so the sweep can be tested without a live DB.
export interface SweepDeps {
  listFilenames?: () => Promise<string[]>;
  isReferenced?: (url: string) => Promise<boolean>;
  remove?: (filename: string) => Promise<void>;
}

// Boot/periodic sweep: walks every blob in `uploaded_files` and deletes the ones
// no record references anymore. Reuses the same reference-check list as the
// per-delete cleanup so a column that keeps a file alive there keeps it alive
// here too. Safe (only deletes zero-reference blobs) and best-effort (never
// throws; a single failure is logged and the sweep moves on). Returns the count
// removed. Reclaims the historical backlog from before per-delete cleanup existed.
export async function sweepOrphanedUploadedFiles(deps: SweepDeps = {}): Promise<number> {
  const listFilenames =
    deps.listFilenames ??
    (async () => {
      const rows = await db.select({ filename: uploadedFiles.filename }).from(uploadedFiles);
      return rows.map((r) => r.filename);
    });
  const isReferenced = deps.isReferenced ?? isUploadReferenced;
  const remove =
    deps.remove ??
    (async (filename: string) => {
      await db.delete(uploadedFiles).where(eq(uploadedFiles.filename, filename));
    });

  let removed = 0;
  try {
    const filenames = await listFilenames();
    for (const filename of filenames) {
      try {
        const url = `/uploads/${filename}`;
        if (await isReferenced(url)) continue;
        await remove(filename);
        removed++;
      } catch (e) {
        console.error(`sweepOrphanedUploadedFiles: failed on ${filename}:`, e);
      }
    }
  } catch (e) {
    console.error("sweepOrphanedUploadedFiles failed:", e);
  }
  return removed;
}
