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
Many columns can hold an `/uploads/...` URL: `users.avatarUrl`, service alerts,
alert updates, news stories, tickets, ticket messages, report requests,
`admin_chat_messages.fileUrl`, downloads, thread messages, community messages.
`server/uploaded-file-cleanup.ts` centralizes this — keep its reference-check
list in sync whenever a new column starts storing upload URLs, or cleanup could
delete a file that's still in use.

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

**Known remaining gaps:** The boot-time orphan sweep in `registerRoutes`
currently only nulls `newsStories.imageUrl`, not references in other tables.
