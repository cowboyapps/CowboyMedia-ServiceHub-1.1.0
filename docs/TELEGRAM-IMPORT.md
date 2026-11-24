# Automatic Telegram service-update drafts

This is an account-based MTProto reader, separate from ServiceHub's outbound
Telegram bot. It reads only the selected broadcast channel and imports text and
photo/video captions; it does not copy media, import old history, join channels,
or publish anything automatically. It checks for new posts approximately every
30 seconds while the application server is running.

## Initial secure setup

1. Create a dedicated account in the official Telegram app using a separate
   phone number. Join the source channel there, completing any owner approval.
2. Register a Telegram API application at https://my.telegram.org/apps to obtain
   `api_id` and `api_hash`. These are not BotFather bot credentials.
3. Configure these **server secrets**:
   - `TELEGRAM_API_ID`: the numeric application ID.
   - `TELEGRAM_API_HASH`: the application hash.
   - `TELEGRAM_IMPORT_ENCRYPTION_KEY`: 32 random bytes, encoded as base64 or
     64 hexadecimal characters. Generate it locally using a password manager
     or `openssl rand -base64 32`. Never paste its value into chat or Git.
4. For this project's external VPS, configure the values in the protected app
   environment file described in [OPERATIONS.md](OPERATIONS.md), not the deploy
   listener's environment file. Replit Secrets do not configure that VPS.
   Follow the existing source-environment-before-PM2-reload instructions there.
   Preview configuration is optional; do not run two environments against the
   same Telegram account login session.
5. Sign in to ServiceHub as a master admin. Open **Admin → Service Updates**.
   Under **Telegram imports**, enter the dedicated phone number, then the
   Telegram login code, and its two-step verification password if requested.
   This requires HTTPS in production. Do not send login details to the agent.
6. Select an already-joined broadcast channel and enable automatic imports.
   Source and outbound announcement channels must be different to avoid loops.
7. Enable device notifications and the **Imported Telegram drafts** preference
   for the admins who should receive pushes. Non-master admins need both
   `service_updates.view` and `service_updates.manage` for review notifications.

The first source selection establishes a current-message baseline. Older posts
are not imported. Pausing and resuming the same source retains its cursor and
catches up on messages received during the pause, in batches of up to 100.
Selecting a different source, or disconnecting and connecting again, establishes
a fresh baseline. Edits/deletions to source posts do not silently overwrite
existing drafts or published updates. Media-only posts without captions are
skipped; the cursor still advances.

## Review and publishing

New drafts are admin-only and live separately from customer service updates.
Their bodies contain the source text with line breaks and web links. Titles and
services are intentionally blank. Admins can save incomplete drafts, complete
the fields and publish through the normal subscriber notification flow, or
delete them. Deleted source IDs are retained as tombstones so retries cannot
bring a discarded post back. Concurrent publish requests create just one
service update. Source links are admin-only and still require Telegram access.

Push notifications use a unique draft deep link. Device delivery depends on
push permissions and connectivity; quiet hours and notification preferences
still apply. A pending-drafts list remains available regardless of push delivery.

## Security and recovery

The stored account session uses AES-256-GCM encryption. Session values, phone
numbers, login codes, passwords and raw Telegram errors are never returned by
the status endpoint or written to request/activity logs. Login challenges are
master-admin-owned, memory-only, expire after five minutes, and have an
eight-failure limit. Requesting codes is throttled. A server restart discards an
unfinished login, but preserves an established encrypted session.

Protect the database and encryption key separately. Losing or rotating the
encryption key requires disconnecting and signing in again; do not rotate it
casually. Disconnect removes ServiceHub's saved session and stops importing,
but does not promise remote revocation when Telegram is unreachable. To revoke
access completely, terminate the ServiceHub session in Telegram **Settings →
Devices** as well. Account/channel restrictions require action in Telegram;
connection failures appear in the admin panel and the existing error log.

Only one worker at a time processes imports using a PostgreSQL advisory lock.
Draft creation, deduplication and cursor advancement commit together. Notification
attempts resume for pending drafts after interruptions; a device may receive a
repeat toast after a crash, but the draft itself is never duplicated.
