---
name: WHMCS customer-only endpoints reject staff server-side
description: Convention — customer billing/WHMCS endpoints must 403 staff (admin/master_admin) before touching WHMCS, fail-closed in the locked shape.
---

Customer-only WHMCS/billing endpoints (the session-user's OWN billing surface) must reject
staff accounts (`role === "admin"` or `"master_admin"`) server-side with a 403, in addition
to any frontend gate.

**Why:** Staff accounts never have a `users.whmcs_client_id` (the WHMCS link is a 1:1
customer-only contract), so a staff request can only ever be a UI-gate bypass or mistake.
Defence-in-depth: never trust the client gate alone for a customer-data boundary.

**How to apply:**
- Resolve the session user, then check staff role AFTER the configured/enabled checks but
  BEFORE the clientId lookup (so unconfigured WHMCS still returns its 503/empty shape first,
  and WHMCS is never queried for a staff account).
- Keep each endpoint's existing **locked-shape** contract: GET routes return the same empty
  payload helper (e.g. `emptyBilling({configured, enabled, linked:false})`,
  `emptyInvoiceDetail`, `emptyProfile`) just with a 403 status; action routes return
  `{ ok:false, message:"Staff accounts can't …" }`. Never 500, never leak.
- Reference implementations: `server/whmcs-pay-link-route.ts` (the original pattern), plus the
  `isStaffRole` helper duplicated in `routes.ts` (`/api/billing` summary + invoice PDF),
  `whmcs-invoice-detail-route.ts`, `whmcs-invoice-service-route.ts`, `whmcs-profile-route.ts`.
- The two inline routes (`/api/billing` summary, invoice PDF) are tested via **mirror** test
  apps that re-implement the route wiring (`whmcs-billing-summary-route.test.ts`,
  `whmcs-invoice-pdf-route.test.ts`) — the extracted-handler routes test the real handler.
