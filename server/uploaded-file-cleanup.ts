import { eq, like, sql } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
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

// Extracts every distinct `/uploads/<filename>` path embedded in a rich-text
// HTML body, returning the bare filenames (no `/uploads/` prefix) in first-seen
// order, de-duplicated. The shared editor stores inline images as
// `<img src="/uploads/<uuid>...">`, so we scan for the `/uploads/` prefix and
// capture up to the first character that can't belong to a filename (quote,
// whitespace, query/fragment marker, angle bracket, closing paren, backslash).
// Used by the KB-image recovery script to discover which blobs an article still
// expects so it can re-insert exactly those (and nothing else) from a backup.
export function extractUploadFilenamesFromHtml(body: string | null | undefined): string[] {
  if (!body) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /\/uploads\/([^"'\s?#)<>\\]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const filename = m[1];
    if (filename && !seen.has(filename)) {
      seen.add(filename);
      out.push(filename);
    }
  }
  return out;
}

// Builds a Postgres LIKE pattern that matches rows whose body contains `url` as
// a substring. Escapes LIKE wildcards (`%`, `_`, `\`) so a filename can never be
// interpreted as a pattern (Postgres uses `\` as the default LIKE escape char).
function uploadLikePattern(url: string): string {
  const escaped = url.replace(/([\\%_])/g, "\\$1");
  return `%${escaped}%`;
}

// How a column stores its `/uploads/...` reference:
//   - "exact": a single-URL column (avatars, cover images, attachments). The
//     whole cell IS the URL → match with `eq`.
//   - "substring": a rich-text HTML body that can embed inline editor images.
//     The `/uploads/...` path lives INSIDE the HTML, not in its own column →
//     match with `like`. Missing these is exactly what wiped in-article KB images.
export type UploadReferenceMatch = "exact" | "substring";

// Every table/column that can persist an `/uploads/...` URL. This is the single
// source of truth for the reference check — and `uploaded-file-cleanup.test.ts`
// walks `shared/schema.ts` and fails if a new `*_url` / `content` / `body_html`
// column appears that isn't either listed here OR explicitly excluded in
// `uploadColumnsIntentionallyUnchecked` below. That guard is what gives us a
// heads-up before the cleanup could ever delete a file that's still in use.
export interface UploadReferenceColumn {
  table: PgTable;
  column: PgColumn;
  match: UploadReferenceMatch;
}

export const uploadReferenceColumns: UploadReferenceColumn[] = [
  // Single-URL columns (exact match):
  { table: users, column: users.avatarUrl, match: "exact" },
  { table: serviceAlerts, column: serviceAlerts.imageUrl, match: "exact" },
  { table: alertUpdates, column: alertUpdates.imageUrl, match: "exact" },
  { table: newsStories, column: newsStories.imageUrl, match: "exact" },
  { table: tickets, column: tickets.imageUrl, match: "exact" },
  { table: ticketMessages, column: ticketMessages.imageUrl, match: "exact" },
  { table: reportRequests, column: reportRequests.imageUrl, match: "exact" },
  { table: adminChatMessages, column: adminChatMessages.fileUrl, match: "exact" },
  { table: downloads, column: downloads.imageUrl, match: "exact" },
  { table: threadMessages, column: threadMessages.imageUrl, match: "exact" },
  { table: communityMessages, column: communityMessages.imageUrl, match: "exact" },
  // Rich-text HTML bodies with inline editor images (substring match):
  { table: newsStories, column: newsStories.content, match: "substring" },
  { table: kbArticles, column: kbArticles.bodyHtml, match: "substring" },
  { table: announcements, column: announcements.bodyHtml, match: "substring" },
  { table: changelogEntries, column: changelogEntries.bodyHtml, match: "substring" },
];

// `*_url` / `content` / `body_html` columns that LOOK upload-bearing by name but
// deliberately never store an `/uploads/...` reference (external links, plain
// text, webhook URLs). The guard test requires every such column in the schema
// to be either covered by `uploadReferenceColumns` above OR listed here with a
// reason — so a genuinely new upload column can't slip in unnoticed. Keyed by
// `"<table>.<db_column>"`.
export const uploadColumnsIntentionallyUnchecked: Record<string, string> = {
  "services.discord_webhook_url": "external Discord webhook URL, never an upload",
  "discord_settings.webhook_url": "external Discord webhook URL, never an upload",
  "downloads.download_url": "external download link, never an upload",
  "whmcs_settings.base_url": "external WHMCS base URL, never an upload",
  "url_monitors.url": "external endpoint being monitored, never an upload",
  "user_notifications.url": "in-app deep-link route, never an upload",
  "community_messages.content": "plain-text chat message, no embedded editor images",
};

// Builds the actual DB reference check for one declared column.
function buildReferenceCheck({ table, column, match }: UploadReferenceColumn) {
  return async (url: string): Promise<boolean> => {
    const condition = match === "exact" ? eq(column, url) : like(column, uploadLikePattern(url));
    const rows = await db.select({ one: sql`1` }).from(table).where(condition).limit(1);
    return rows.length > 0;
  };
}

const referenceChecks: Array<(url: string) => Promise<boolean>> =
  uploadReferenceColumns.map(buildReferenceCheck);

// True when any record still points at `url`.
export async function isUploadReferenced(url: string): Promise<boolean> {
  const results = await Promise.all(referenceChecks.map((check) => check(url)));
  return results.some(Boolean);
}

// A KB article / news story that embeds at least one `/uploads/<uuid>` image
// whose backing blob is gone from `uploaded_files`. Surfaced to admins so a
// silently-broken inline image can be re-uploaded before a customer notices.
export interface MissingImageReference {
  type: "kb_article" | "news_story";
  id: string;
  title: string;
  // Bare filenames (no `/uploads/` prefix) the body references but that have no
  // matching `uploaded_files` row, first-seen order, de-duplicated.
  missingFilenames: string[];
}

// Injectable seams so the scan can be tested without a live DB.
export interface MissingImageDeps {
  listUploadedFilenames?: () => Promise<Set<string>>;
  listKbArticles?: () => Promise<Array<{ id: string; title: string; bodyHtml: string | null }>>;
  listNewsStories?: () => Promise<Array<{ id: string; title: string; content: string | null }>>;
}

// Read-only health check: walks every KB article and news story, extracts the
// `/uploads/<filename>` paths embedded in its rich-text body, and reports the
// ones with no matching row in `uploaded_files`. Loads the full set of present
// filenames once (a single SELECT) and tests each reference against it in
// memory, so the whole scan is two table reads + the uploaded-files read, never
// a per-reference query. Never deletes or mutates anything.
export async function findMissingUploadReferences(
  deps: MissingImageDeps = {},
): Promise<MissingImageReference[]> {
  const listUploadedFilenames =
    deps.listUploadedFilenames ??
    (async () => {
      const rows = await db.select({ filename: uploadedFiles.filename }).from(uploadedFiles);
      return new Set(rows.map((r) => r.filename));
    });
  const listKbArticles =
    deps.listKbArticles ??
    (async () =>
      db
        .select({ id: kbArticles.id, title: kbArticles.title, bodyHtml: kbArticles.bodyHtml })
        .from(kbArticles));
  const listNewsStories =
    deps.listNewsStories ??
    (async () =>
      db
        .select({ id: newsStories.id, title: newsStories.title, content: newsStories.content })
        .from(newsStories));

  const present = await listUploadedFilenames();
  const out: MissingImageReference[] = [];

  const articles = await listKbArticles();
  for (const a of articles) {
    const missing = extractUploadFilenamesFromHtml(a.bodyHtml).filter((f) => !present.has(f));
    if (missing.length > 0) {
      out.push({ type: "kb_article", id: a.id, title: a.title, missingFilenames: missing });
    }
  }

  const stories = await listNewsStories();
  for (const s of stories) {
    const missing = extractUploadFilenamesFromHtml(s.content).filter((f) => !present.has(f));
    if (missing.length > 0) {
      out.push({ type: "news_story", id: s.id, title: s.title, missingFilenames: missing });
    }
  }

  return out;
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
