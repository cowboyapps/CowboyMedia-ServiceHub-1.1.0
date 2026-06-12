import type { Request, Response } from "express";

// Shared post-response wiring for the customer billing self-action routes
//   POST /api/billing/services/:serviceId/cancel
//   POST /api/my/services/:serviceId/password
//
// Both routes perform a WHMCS WRITE that mutates the caller's live billing
// state, so the moment one SUCCEEDS we drop that client's cached billing data
// (summary + transaction history + combined customer self-view) — otherwise the
// billing page would keep serving the stale pre-action snapshot until the 60s
// TTL expires.
//
// Extracted from registerRoutes so this gating is testable against the real
// wiring (same pattern as the handler factories). The contract is deliberately
// narrow:
//   1. Invalidate ONLY on a 200 — degraded / non-200 responses (404, 409, 502,
//      validation errors) must leave the cache untouched, because nothing
//      actually changed on the WHMCS side.
//   2. The client id is resolved from the SESSION user, never request input.
//   3. A user with no linked WHMCS client has nothing to invalidate — no-op.

export interface BillingCacheInvalidatorUser {
  whmcsClientId?: number | null;
}

export interface BillingCacheInvalidatorDeps {
  getUser: (id: string) => Promise<BillingCacheInvalidatorUser | null | undefined>;
  invalidate: (clientId: number) => void;
}

/**
 * Build the after-handler hook that invalidates the actor's billing caches once
 * a self-action handler has responded. Call it AFTER awaiting the handler:
 *
 *   await handler(req, res);
 *   await invalidateAfterSelfAction(req, res);
 *
 * Returns the client id whose caches were dropped, or null when nothing was
 * invalidated (non-200 response, no session user, or no linked client). The
 * return value is purely informational — callers don't need to use it.
 */
export function createBillingCacheInvalidator(deps: BillingCacheInvalidatorDeps) {
  return async function invalidateAfterSelfAction(
    req: Request,
    res: Response,
  ): Promise<number | null> {
    const userId = req.session?.userId;
    if (res.statusCode !== 200 || !userId) return null;
    const actor = await deps.getUser(userId);
    if (!actor?.whmcsClientId) return null;
    deps.invalidate(actor.whmcsClientId);
    return actor.whmcsClientId;
  };
}
