---
name: Alert service-status recompute
description: When and why every service-alert lifecycle route must recompute and broadcast affected services.
---

# Alert → service-status recompute invariant

A service's `status` is a derived value: the most-severe `impact` among the
still-active (non-resolved) alerts that cover it (rank outage > degraded >
maintenance > operational; missing impact defaults to degraded). Alerts cover
many services via the `alert_services` junction table.

**Rule:** ANY route that changes which services an alert covers, or removes
active coverage, must loop over every affected service id and call
`storage.recomputeServiceStatus(sid)` **and** `broadcast({ type: "service_updated", serviceId: sid })`.
This includes create, edit (service-set change — recompute the union of old+new
ids), add-update (impact change), resolve, AND delete.

**Why:** recompute is the only thing that flips a service back toward operational.
Forgetting it on any one path strands a service at a stale non-operational status
forever (delete was the path originally missed — deleting an active alert left its
services stuck). Missing the broadcast leaves real-time clients showing stale
status until a manual refetch.

**Shared-service correctness:** because recompute reads ALL active alerts for the
service, resolving/deleting one alert correctly keeps a service non-operational if
another active alert still covers it. Don't shortcut by setting status directly
from the alert being mutated.

**How to apply:** when touching any alert route in `server/routes.ts`, grep for
`recomputeServiceStatus` to confirm the pattern is present on that path before
shipping.
