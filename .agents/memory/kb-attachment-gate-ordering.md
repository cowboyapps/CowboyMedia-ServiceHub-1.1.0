---
name: KB attachment gate ordering
description: Why the admin-only KB-link gate + slug resolution must run before any uploaded file is persisted on message routes.
---

# KB attachment gate must run before persisting uploads

On message-thread routes (and the sibling community-chat / ticket message
routes that share `resolveKbArticleAttachment`), the admin-only KB-link check
and slug resolution must complete and pass **before** `saveUploadedFile` is
called.

**Why:** uploads are persisted as base64 blobs in the `uploaded_files` table.
If the file were saved first and the KB rule rejected the request afterward,
the rejected request would leave an orphaned blob behind. The gate is also a
security boundary: non-admins must not be able to attach KB links, and an
invalid/unpublished slug must be rejected.

**How to apply:** the shared decision lives in
`resolveKbAttachmentForSender` (`server/message-attachments.ts`) — call it,
bail on `!ok`, and only then resolve `req.file` into storage. Order of the
three rejections is fixed: admin gate (403) → slug lookup (400) → presence
check (400, empty body allowed only when an image or KB link is present).
Don't reorder file persistence ahead of these checks.
