---
name: WHMCS customer-only endpoints block UNLINKED staff (not all staff)
description: Convention — customer billing/WHMCS endpoints 403 only UNLINKED staff; staff who are also linked WHMCS customers get their own session-scoped billing.
---

Customer-only WHMCS/billing endpoints (the session-user's OWN billing surface) must reject
only **unlinked** staff accounts server-side with a 403 — NOT all staff. Use the single
source of truth `isUnlinkedStaff(role, whmcsClientId)` in `server/roles.ts`
(`isStaffRole(role) && !whmcsClientId`), never a bare `isStaffRole(role)` guard.

**Why:** A staff member (admin / master_admin) can ALSO be a real paying WHMCS customer whose
own account carries a `users.whmcs_client_id`. The original guards rejected ALL staff on the
false assumption that staff never have a client id — that 403'd the site owner (a master_admin
who is also a customer), and the frontend renders any non-2xx `/api/billing` as
"Billing unavailable — try again later". Every billing route scopes its data to the session
user's OWN linked client (clientId derived from `req.session.userId`, never request input), so
serving a linked staff member their own billing leaks nothing.

**How to apply:**
- Resolve the session user, then check `isUnlinkedStaff(...)` AFTER the configured/enabled
  checks but BEFORE the clientId lookup (unconfigured WHMCS still returns its 503/empty shape
  first; WHMCS is never queried for a blocked account).
- Keep each endpoint's **locked-shape** contract: GET routes return the same empty payload
  helper (`emptyBilling({configured, enabled, linked:false})`, `emptyInvoiceDetail`,
  `emptyProfile`, …) with a 403 status; action routes return
  `{ ok:false, message:"Staff accounts can't …" }`. Never 500, never leak.
- `whmcsClientId: 0` counts as unlinked (`!whmcsClientId`), consistent with each route's own
  `if (!clientId)` unlinked branch; real WHMCS ids are positive.
- Guard sites: billing summary, invoice detail/service/PDF, pay-link (single + all), profile
  (GET + PATCH), refresh, password reset, cancellation.
- Tests: "staff blocked" fixtures use `whmcsClientId: null` (unlinked → still 403); add a
  linked-staff-served regression (e.g. `/api/billing` 200 with `linked:true`). Helper
  semantics are locked by `server/roles.test.ts`.
