import type { Request, Response } from "express";
import { hasWhmcsCredentials, normalizeBaseUrl } from "./whmcs";
import { loadBillingSummary as defaultLoadBillingSummary, type BillingSummaryData } from "./whmcs-billing";
import { getParam } from "./http-params";
import { getErrorMessage } from "./error-utils";

// Handler factory for the admin customer-detail billing endpoint:
//   GET /api/admin/users/:id/whmcs/billing
//
// Extracted from registerRoutes so the credential-free contract can be unit-
// tested directly against the production handler. The guarantee under test: the
// admin/staff billing payload NEVER carries service login credentials
// (username/password). Those are stripped inside buildBillingSummary
// (stripProductCredentials) and only ever surface to the customer via
// GET /api/my/services. A refactor that forwarded raw WHMCS products here would
// leak every customer's service passwords to any admin with users.view — the
// route-level test guards exactly that regression.

export interface AdminBillingRouteUser {
  whmcsClientId?: number | null;
}

export interface AdminBillingRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface AdminBillingRouteDeps {
  getUser: (id: string) => Promise<AdminBillingRouteUser | null | undefined>;
  getWhmcsSettings: () => Promise<AdminBillingRouteSettings | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real summary loader; injectable for tests. */
  loadBillingSummary?: (clientId: number, baseUrl: string | null) => Promise<BillingSummaryData>;
}

/** The locked degraded shape every billing response carries. */
export function emptyBilling(over: Record<string, unknown>) {
  return {
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    client: null,
    balance: null,
    invoices: [],
    products: [],
    transactions: [],
    transactionsUnreachable: false,
    portalUrl: null,
    payAll: null,
    ...over,
  };
}

/**
 * Admin customer-detail view: a specific customer's WHMCS billing summary. The
 * summary is credential-free by construction (buildBillingSummary strips the
 * service username/password). Permission-gated upstream (users.view /
 * users.manage). Degrades to a clean unconfigured / disabled / unlinked /
 * unreachable shape.
 */
export function createAdminBillingHandler(deps: AdminBillingRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadBillingSummary ?? defaultLoadBillingSummary;
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyBilling({ configured, enabled, linked: !!clientId }));
      }
      const summary = await load(clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...summary });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
