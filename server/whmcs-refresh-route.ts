import type { Request, Response } from "express";
import { invalidateBillingCaches as defaultInvalidateBillingCaches } from "./whmcs-billing";
import { isUnlinkedStaff } from "./roles";

// Handler factory for the customer billing-cache refresh endpoint:
//   POST /api/billing/refresh
//
// Extracted from registerRoutes so the security-critical contract can be
// unit-tested directly against the production handler (same pattern as
// createRequestCancellationHandler / createUpdateProfileHandler).
//
// The endpoint is fired by the billing page when it regains focus after the
// customer followed a WHMCS pay deep link: payments settle on WHMCS's off-site
// hosted checkout, so our server never sees them, and the per-client cache can
// keep showing the just-settled invoice for up to the 60s TTL. This drops the
// caller's OWN cached billing so the next /api/billing load re-fetches fresh.
//
// Two contracts under test:
//   1. Ownership — the WHMCS client id is ALWAYS resolved from the SESSION user
//      (never request input), so a customer can only ever bust their OWN cache,
//      never another client's. An unlinked user invalidates nothing.
//   2. Never 500s — cache invalidation is best-effort; storage failures degrade
//      to a stable { ok: true } so the customer's page never errors.

export interface RefreshRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface RefreshRouteDeps {
  getUser: (id: string) => Promise<RefreshRouteUser | null | undefined>;
  /** Defaults to the real cache invalidator; injectable for tests. */
  invalidateBillingCaches?: (clientId: number) => void;
}

/**
 * Customer self-action: force-drop the session user's OWN cached billing so the
 * next /api/billing load re-fetches fresh from WHMCS. ALWAYS derives the client
 * id from the session user (never request input). Pure no-throw — always returns
 * { ok: true }, even when the user is unlinked or storage throws.
 */
export function createBillingRefreshHandler(deps: RefreshRouteDeps) {
  const invalidate = deps.invalidateBillingCaches ?? defaultInvalidateBillingCaches;
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(req.session.userId!);
      // Defence-in-depth: reject staff who AREN'T themselves a linked WHMCS
      // customer — they can only reach this via a UI-gate bypass. A staff member
      // who is also a paying customer (has their own whmcs_client_id) is served
      // like any other customer. WHMCS/cache is never touched for blocked staff.
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ ok: false, message: "Staff accounts can't use customer billing actions." });
      }
      if (user?.whmcsClientId) invalidate(user.whmcsClientId);
    } catch {
      // Cache invalidation is best-effort — never 500 for the customer.
    }
    return res.json({ ok: true });
  };
}
