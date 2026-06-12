---
name: OTP attempt-cap must consume in-request
description: Email/OTP code verify routes must invalidate the code on the Nth wrong attempt within the same request, and resend must retire prior active rows.
---

# OTP attempt-cap: consume on the capping attempt, not lazily

When a verify route caps wrong attempts (e.g. max 5), it must invalidate
(consume) the code in the SAME request where the cap is reached — not on a
later request. The classic bug: a leading guard `if (attempts >= MAX) consume`
checked before comparing the code means the Nth wrong guess only bumps the
counter and returns invalid; the code is consumed on the (N+1)th request,
leaving it briefly reusable.

**Why:** an account-linking / auth OTP gate that doesn't invalidate on the
final wrong attempt is a brute-force hardening miss; a code review will block it.

**How to apply:** on a mismatch, bump attempts, then decide via a pure helper
(prior+1 >= max ⇒ too_many_attempts + consume now; else invalid_code with
remaining). Also retire any still-active code for the user before issuing a new
one (resend), so two valid codes never coexist.

The pure decision lives in `shared/whmcs-link.ts` (`whmcsLinkFailureOutcome`) so
it's unit-testable without a server/DB; the WHMCS link verify route consumes it.
