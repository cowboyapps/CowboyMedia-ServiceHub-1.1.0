---
name: WHMCS "service ready" retry marker pinning
description: Why a failed ready-notification in-app create must pin the service marker at "pending", not just skip fulfilling the order.
---

The WHMCS service notifier fires the one-time "your new service is ready"
notification ONLY on a strict `pending -> active` marker transition (never on
first baseline). It creates the in-app bell first and only consumes/fulfills the
matched pending order once that succeeds.

**Rule:** when the in-app create fails (returns null), leaving the order
unfulfilled is NOT enough — you must ALSO keep the service marker at its previous
status (`pending`). Otherwise the same pass's normal marker-update path advances
the marker to `active`, and the next pass no longer sees a `pending -> active`
transition, so the notification is permanently dropped.

**Why:** detection is transition-based (prev marker vs current status), not
order-based. The unfulfilled order alone can't re-trigger anything once the
marker has moved past `pending`.

**How to apply:** the ready helper returns a "retry needed" boolean; the caller
ORs it into the "don't advance status" condition (alongside the statusEvent
check) so `newStatus` stays pinned to the prior status. Regression must be a
TWO-pass test (fail then succeed) — a single-pass "order not fulfilled" assertion
does not prove the retry actually happens.
