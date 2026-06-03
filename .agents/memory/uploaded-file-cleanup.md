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

**Known remaining gaps (as of Task #278):** only the message-thread delete path
cleans up. Ticket message/ticket delete and community-chat message delete paths
still leak blobs; the boot-time orphan sweep in `registerRoutes` only nulls
`newsStories.imageUrl`, not other tables.
