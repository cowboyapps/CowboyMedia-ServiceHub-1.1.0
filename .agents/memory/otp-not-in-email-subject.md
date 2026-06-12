---
name: OTP / secret codes must never live in email subjects
description: Why one-time codes belong only in the email body, never the subject line
---

# OTP / secret codes must never live in an email subject

Never put a one-time code, token, or secret in an email **subject** line.

**Why:** `server/email.ts` logs every send as `console.log("Email sent to ${to}: ${subject}")`.
A `{code}` placeholder in the subject is interpolated before send, so the live OTP
ends up in plaintext server logs (PM2 / journald), which widens the blast radius of
any log exposure into account-takeover risk. The email **body** is never logged, so
codes are safe there.

**How to apply:** When adding a templated email that carries a verification code,
reset link token, or any secret, keep the secret out of `subject` and put it only in
`body`. A regression test can assert the template's `subject` does not contain the
secret placeholder (see `test/whmcs-link.test.ts`).
