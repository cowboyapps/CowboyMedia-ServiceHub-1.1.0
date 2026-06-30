---
name: Idempotency middleware client-abort semantics
description: Why money-write idempotency must NOT abandon a claimed key on early socket close
---

# Idempotency middleware & client aborts

A client timeout (e.g. apiRequest's 30s AbortController) closes the socket, firing
Express `res` `close` BEFORE the handler sends its response. Node does NOT kill the
handler — the WHMCS write keeps running server-side and may still land.

**Rule:** On an early `close` (before `didCapture` — handler hasn't called res.json),
do NOT `abandonIdempotent`. Abandoning frees the key so a retry re-runs the write =
double-charge. Instead leave the key PENDING (retry gets 409) and finalize when the
still-running handler reaches the patched `res.json` (which settles: complete if
`whmcsWriteAttempted`, else abandon). `finish` never fires after a socket abort, so
res.json — not the `close`/`finish` listeners — must own finalization in that path.

**Why:** code review caught that settling/abandoning on `close` reintroduced the exact
double-charge the task was meant to prevent.

**How to apply:** any in-process idempotency/replay guard fronting a money write must
treat early `close` as "pending, keep blocking", never "free to retry".
