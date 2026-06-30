---
name: WHMCS "new service added" detection
description: How the WHMCS poller distinguishes a directly-ordered new service from the store "ready" path without double-notifying.
---

# WHMCS "added" vs "ready" detection

The WHMCS service notifier announces a brand-new service two different ways depending on how it appeared, and they must NEVER both fire for the same provision.

- **"added"** fires on a service's FIRST sighting (no prior marker) for a customer who has ALREADY been baselined — i.e. ordered directly in WHMCS, outside the ServiceHub store.
- **"ready"** fires on a later pending->active transition (the service already HAS a marker from a prior baseline).

**Why they can't be merged:** a store order is baselined as Pending then transitions to Active (→ ready); a direct WHMCS order simply appears already-Active with no marker (→ added).

## The double-notify guard
When "added" fires it consumes + fulfills any matching pending order (matched by product id / `pid`). The "ready" path requires an *unfulfilled* order, so consuming it prevents ready from replaying for the same provision on a later pass.

**How to apply:** any new code path that announces a new service must either (a) check for a prior marker, or (b) consume the matching pending order, or it risks double-notifying.

## Per-customer baseline gate
- First-ever poll per customer (not yet baselined): every first-sighting is recorded SILENTLY (no announcement), then the customer is marked baselined AFTER the full reachable pass. This runs even for zero-service customers (so the marker write lives after the plans loop, not inside it).
- Baseline read failure → fail SAFE: treat as NOT baselined (silently baseline) rather than risk falsely announcing pre-existing services as "added".
- A mid-pass throw skips the post-loop `recordServiceBaseline`, so the whole pass retries next time.

## Retry semantics (mirror the ready path)
"added" fires three primary/secondary channels in order: persist announcement row (idempotent on (user,service)) → bell row → consume order → push (gated on opt-in category + quiet hours) → broadcast. If the announcement insert OR the bell create fails, leave the service UNMARKED (return false, `continue`) so the next pass retries the whole announcement.
