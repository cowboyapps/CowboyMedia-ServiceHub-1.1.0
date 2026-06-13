import type { Request, Response } from "express";
import { hasWhmcsCredentials, normalizeBaseUrl } from "./whmcs";
import {
  loadCustomerBillingWithServices as defaultLoadCustomerBillingWithServices,
  type CustomerBillingData,
} from "./whmcs-billing";
import { emptyBilling } from "./whmcs-admin-billing-route";
import { isStaffRole } from "./roles";

// Handler factory for the customer billing-summary endpoint:
//   GET /api/billing
//
// Extracted from registerRoutes so the security-critical contract can be unit-
// tested directly against the production handler (same pattern as
// createCustomerInvoiceDetailHandler in server/whmcs-invoice-detail-route.ts).
// The route is scoped to the SESSION user's OWN linked WHMCS client; staff
// accounts never have one, so they are rejected server-side (defence-in-depth,
// Task #439) even if a UI gate is bypassed. It NEVER 500s and NEVER forwards raw
// WHMCS error strings — every failure degrades to the locked `emptyBilling`
// shape so the page always renders.

export interface BillingSummaryRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface BillingSummaryRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface BillingSummaryRouteDeps {
  getWhmcsSettings: () => Promise<BillingSummaryRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<BillingSummaryRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  loadCustomerBillingWithServices?: (clientId: number, baseUrl: string | null) => Promise<CustomerBillingData>;
}

/**
 * Customer self-view: the logged-in user's OWN linked WHMCS billing summary.
 * Never accepts a clientId param, never forwards raw WHMCS error strings (they
 * can leak server IPs), and never 500s — it degrades to a clean disabled /
 * unlinked / unreachable state so the page always renders. The invoice rows AND
 * payment-history rows are labelled with the hosting service each renewed; each
 * section degrades on its own.
 */
export function createCustomerBillingHandler(deps: BillingSummaryRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadCustomerBillingWithServices ?? defaultLoadCustomerBillingWithServices;
  return async (req: Request, res: Response) => {
    try {
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyBilling({ configured, enabled }));
      }
      const user = await deps.getUser(req.session.userId!);
      if (isStaffRole(user?.role)) {
        return res.status(403).json(emptyBilling({ configured, enabled, linked: false }));
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyBilling({ configured, enabled, linked: false }));
      }
      const { summary, transactions, transactionsUnreachable } = await load(clientId, baseUrl);
      return res.json({
        configured,
        enabled,
        linked: true,
        ...summary,
        transactions,
        transactionsUnreachable,
      });
    } catch {
      // Never leak / never 500 for the customer — show a clean unreachable state.
      return res.json(emptyBilling({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}
