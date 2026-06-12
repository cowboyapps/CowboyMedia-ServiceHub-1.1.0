---
name: OTP / secret codes must never live in email subjects
description: Why one-time codes belong only in the email body, never the subject line
---

# OTP / secret codes must never live in an email subject

Never put a one-time code, token, or secret in an email **subject** line.

There are TWO logging vectors, both must be closed for any OTP/secret email:

1. **Subject → console log.** `server/email.ts` logs every send as
   `console.log("Email sent to ${to}: ${subject}")`. A `{code}` in the subject is
   interpolated before send, so the live OTP lands in plaintext stdout/PM2/journald.
2. **Rendered body → activity log.** `sendTemplatedEmail` in `server/routes.ts`
   writes the full rendered `body` into the `email_sent` activity-log row's
   `details` JSON — UNLESS the template key is in its `sensitiveTemplates` allowlist
   (only `password_reset` by default). For sensitive templates it logs metadata only.

**Why:** either vector persists the one-time code in plaintext (server logs / DB),
widening any log exposure into account-takeover risk.

**How to apply:** for any templated email carrying a code/token/secret:
(a) keep the secret out of `subject` (put it only in `body`), AND
(b) add the templateKey to `sensitiveTemplates` in `server/routes.ts` so the body is
not logged. A regression test can assert the subject has no secret placeholder
(see `test/whmcs-link.test.ts`).
