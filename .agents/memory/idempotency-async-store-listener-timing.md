---
name: Idempotency async-store listener timing
description: Why response lifecycle listeners must be attached synchronously when the idempotency store became async (DB-backed)
---

When a request-dedup / idempotency middleware backs its claim with an async store
(Postgres etc.) instead of a synchronous in-process Map, attach the `res`
`close`/`finish` listeners **synchronously at middleware entry — before awaiting
the claim**. Do not attach them inside the `async`/`await` block after the claim.

**Why:** the async claim does DB round-trips (DELETE expired + INSERT..ON CONFLICT
+ SELECT), which can take tens of ms. A fast client abort (e.g. a 30–50ms timeout)
can fire `res`'s `close` event *during* the claim, before the listeners exist, so
the abort is silently missed. The pending row then never gets finalized, and every
later retry sees a stale `pending` row → spurious permanent 409. With a synchronous
Map claim this was free (listeners were always registered before any abort), so the
bug only appears after the store goes async. Symptom in tests: an abort-mid-write
e2e case gets 409 on the post-release retry instead of a 200 replay, and no `close`
log ever fires.

**How to apply:** keep `claimed/captured/didCapture/closedEarly/settled` state in
the middleware closure (not inside the async IIFE). Register `res.on("close")` /
`res.on("finish")` up top; make `settle()` a no-op until the key is actually
claimed (`if (!claimed) return`). Only the claim + completion DB writes go in the
async IIFE. Also persist the outcome BEFORE sending the normal response
(`settle().finally(() => originalJson(body))`) so a client retry never races a
still-`pending` row into a 409. A client-abort-before-response must still leave the
key PENDING (never abandon) to keep the double-charge window shut.
