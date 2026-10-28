---
name: Ticket deletion product requirement
description: User expects admin-deleted ticket messages to disappear for everyone and from transcripts.
---

Admins must be able to delete sent support-ticket messages for both the admin and the ticket creator, like Telegram's delete-message feature. Deleted messages must no longer be available in the customer's app/device or in newly generated transcripts.

**Why:** The user explicitly requested deletion for everyone, not an admin-only hide action.

**How to apply:** Implement authoritative removal and reconcile customer sessions/caches, including missed events after reconnect. Do not promise recall of already delivered emails, previously exported files, screenshots, backups, or offline devices before reconnect.
