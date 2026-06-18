---
name: Uploaded-file orphan cleanup
description: How/where uploaded image blobs are stored and the safe rule for deleting them when an owning record is removed.
---

# Uploaded-file orphan cleanup

Uploaded images are stored as base64 rows in the `uploaded_files` table (NOT on
disk); `saveUploadedFile` in `server/routes.ts` returns a `/uploads/<uuid>` URL
that the `GET /uploads/:filename` route serves. Deleting a record that holds such
a URL does NOT remove the blob unless code explicitly does so.

**Rule:** before deleting an uploaded blob, confirm NO other record references it.
Two kinds of columns can hold an `/uploads/...` URL and BOTH must be in the
reference list, or cleanup deletes a file that's still in use:
1. **Single-URL columns** (exact `eq` match): `users.avatarUrl`, service alerts,
   alert updates, `news_stories.image_url`, tickets, ticket messages, report
   requests, `admin_chat_messages.fileUrl`, downloads, thread messages,
   community messages.
2. **Rich-text HTML body columns** (substring `like` match) — the shared
   rich-text editor (`POST /api/admin/upload-inline-image`) embeds inline images
   as `<img src="/uploads/<uuid>">` INSIDE the HTML, so the URL lives in the body
   text, not its own column: `kb_articles.body_html`, `news_stories.content`,
   `announcements.body_html`, `changelog_entries.body_html`. A pure substring
   helper `bodyHtmlReferencesUpload(body, url)` mirrors the SQL `LIKE` semantics
   for tests.

**Why this matters:** the boot sweep once wiped customer KB-article images
because only single-URL columns were checked — an image embedded only inside a KB
body had zero detected references and got swept. Any NEW rich-text/HTML column
that can carry inline editor images MUST get a substring reference check too.
`server/uploaded-file-cleanup.ts` centralizes both kinds — keep its
reference-check list in sync whenever a new column starts storing upload URLs
(single-URL OR embedded-in-HTML), or cleanup could delete a file that's still in
use.

**Why:** filenames are unique UUIDs so collisions are unlikely, but the full
reference check is the safety net. Run cleanup AFTER deleting the owning row so
the row's own reference doesn't keep the file alive; make it best-effort (never
throw) so a cleanup failure can't break the user-facing delete.

**Boot sweep:** the boot-time IIFE in `registerRoutes` nulls dangling
`newsStories.imageUrl` AND then calls `sweepOrphanedUploadedFiles()` (in
`server/uploaded-file-cleanup.ts`), which deletes every `uploaded_files` blob
that the shared `isUploadReferenced` list finds zero references for — reclaiming
the historical backlog. Best-effort per-file; logs the count removed.

**Cleaned-up delete paths:** message-thread delete, ticket delete (its own
image + every message image, internal included), individual ticket-message
delete, and community-chat message delete (`DELETE /api/community-chat/messages/:id`)
now clean up inline via `deleteUploadedFileIfUnreferenced` AFTER the row(s) are gone.
Community-chat is the last of the known per-delete leaks to be closed.

**No known remaining gaps:** the boot-time sweep now calls
`sweepOrphanedUploadedFiles()`, which deletes every zero-reference blob across all
tables in `isUploadReferenced` (not just `newsStories.imageUrl`).

**Reverse direction — broken-image health scan:** the cleanup module also exposes
`findMissingUploadReferences()` (read-only), the inverse of the sweep: it walks
`kb_articles.body_html` + `news_stories.content`, extracts embedded
`/uploads/<uuid>` paths via `extractUploadFilenamesFromHtml`, and reports the ones
with NO matching `uploaded_files` row (a silently-broken inline image). Loads all
present filenames once into a Set, tests in memory. Surfaced master-admin-only via
`GET /api/admin/health/missing-images` and a badge on the admin-dashboard System
Health tile. Never mutates. If you add another rich-text body column, add it here
too (mirror of the reference-check list).
