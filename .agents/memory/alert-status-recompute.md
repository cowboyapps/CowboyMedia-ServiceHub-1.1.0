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

**How to apply:** the orchestration is centralised in `server/alert-status.ts`
(`recomputeForCoveredServices` for create/add-update/resolve/delete;
`recomputeForServiceChange(prev, next)` for the edit path's old+new union). The
six service-alert admin routes now live in `server/alert-routes.ts`
(`registerAlertRoutes(app, middleware, deps)`), extracted out of the monolithic
`registerRoutes` so they can be mounted on a bare Express app with injected
collaborators. Each route builds its own `alertStatusDeps` from the injected
`{ storage, broadcast }` and calls the helper. Add any new alert path there and
call the helper rather than re-inlining the loop.

**Tests:** `server/alert-status.test.ts` has BOTH layers — spy unit tests for the
helper logic AND route-level wiring tests that mount `registerAlertRoutes` on a
throwaway app, HTTP-call each mutation path, and assert recompute +
`service_updated` fire for the right ids. The wiring tests are the safety net: if
a route drops its recompute/broadcast call, the matching test fails (verified by
removing the delete-path call → only the DELETE test failed). When adding a new
alert route, add a matching wiring test using the `routeHarness` helper.
