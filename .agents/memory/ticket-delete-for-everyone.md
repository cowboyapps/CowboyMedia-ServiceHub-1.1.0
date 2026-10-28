---
name: Ticket deletion product requirement
description: User expects admin-deleted ticket messages to disappear for everyone and from transcripts.
---

Admins must be able to delete sent support-ticket messages for both the admin and the ticket creator, like Telegram's delete-message feature. Deleted messages must no longer be available in the customer's app/device or in newly generated transcripts.

**Why:** The user explicitly requested deletion for everyone, not an admin-only hide action.

**How to apply:** Implement authoritative removal and reconcile customer sessions/caches, including missed events after reconnect. Do not promise recall of already delivered emails, previously exported files, screenshots, backups, or offline devices before reconnect.

**Cache constraint:** Revocable ticket media must not be treated as immutable public assets. Previously issued long-lived cache headers cannot be undone just by changing the server response; upgraded service workers must bypass/purge legacy copies, and old or offline clients need to update/reconnect before reconciliation can be guaranteed.

**Why:** Uploaded files were originally served with a year-long immutable cache lifetime, which conflicts with deleting a ticket attachment for everyone.

**Service-worker navigation constraint:** File links opened in a new tab are navigation requests too. Route revocable uploads before offline-shell handling, and only cache/fallback to actual app HTML documents. Cache migration must also detect attachment responses mistakenly stored under the root shell key, not just keys beginning with the upload path.

**Why:** A generic navigation handler can put private attachment bytes under `/`, defeating upload-path purges and serving deleted media as an offline fallback.
