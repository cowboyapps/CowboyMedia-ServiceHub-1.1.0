---
name: WHMCS push-notifier marker gating
description: When a WHMCS-derived background notifier may and may not write its per-item dedup marker.
---

WHMCS-derived background notifiers (ticket-reply, invoice due/overdue, and any
future one) poll linked customers and de-dupe with a per-item marker row. Two
gates decide whether the marker is written on a given pass:

1. **Reachability gate.** If the WHMCS list read comes back `unreachable`,
   `continue` BEFORE reading state or writing any marker. This is what makes a
   missing WHMCS API permission (e.g. `GetInvoices` not yet granted on the API
   role) degrade cleanly: every list is unreachable, nothing is recorded, and
   the instant the permission is granted the first reachable pass notifies.

2. **Quiet-hours gate.** Record the marker when the item was actually delivered
   OR when the customer's channel prefs for that category are entirely OFF.
   SKIP the marker when prefs are ON but quiet-hours suppressed the send right
   now — so the next post-quiet-hours pass retries and the customer still gets
   it. Implement this with TWO distinct pref checks: the delivery check folds in
   quiet hours (customerWantsPush/Email → shouldSuppressNotification), while the
   "prefs on at all?" check uses userWantsChannel(push)||userWantsChannel(email)
   directly, ignoring quiet hours.

**Why:** without gate 1, a missing permission would scribble markers and then
silently never notify once granted; without gate 2's skip, a quiet-hours-timed
obligation would be marked "done" and never actually reach the customer.

**How to apply:** copy this two-gate shape when adding the next WHMCS notifier.
Stage/seen markers persist day-over-day, so a skipped marker re-delivers safely.
