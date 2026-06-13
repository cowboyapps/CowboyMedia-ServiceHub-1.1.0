import type { Request, Response } from "express";
import { getParam } from "./http-params";
import { hasWhmcsCredentials, normalizeBaseUrl } from "./whmcs";
import { loadInvoiceDetail as defaultLoadInvoiceDetail, type InvoiceDetailData } from "./whmcs-billing";

// Handler factories for the single-invoice detail endpoints:
//   GET /api/billing/invoices/:invoiceId                        (customer self)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId  (admin)
//
// Extracted from registerRoutes so the security-critical client-id derivation
// can be unit-tested directly against the production handler (same pattern as
// createDashboardHandler in server/dashboard.ts). The WHMCS client id is ALWAYS
// resolved from the SESSION user (customer) / SELECTED user (admin) — never from
// request input — then handed to loadInvoiceDetail, which rejects any invoice
// whose owner doesn't match (collapsed to notFound so foreign invoice ids can't
// be enumerated). Both handlers are READ-ONLY and the customer handler NEVER
// 500s — every failure degrades to a stable JSON shape.

export interface InvoiceDetailRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

/** Staff roles barred from the customer-only billing reads. */
function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

export interface InvoiceDetailRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface InvoiceDetailRouteDeps {
  getWhmcsSettings: () => Promise<InvoiceDetailRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<InvoiceDetailRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  loadInvoiceDetail?: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<InvoiceDetailData>;
}

/** The locked degraded shape every billing-invoice-detail response carries. */
export function emptyInvoiceDetail(over: Record<string, unknown>) {
  return {
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    notFound: false,
    invoice: null,
    ...over,
  };
}

/**
 * Customer self-view: a single invoice's full detail, scoped to the logged-in
 * user's OWN linked WHMCS client. The client id is ALWAYS derived from the
 * session user — never request input. Never 500s; degrades to a clean
 * disabled / unlinked / unreachable / notFound state.
 */
export function createCustomerInvoiceDetailHandler(deps: InvoiceDetailRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  return async (req: Request, res: Response) => {
    try {
      const invoiceId = Number(getParam(req, "invoiceId"));
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyInvoiceDetail({ configured, enabled }));
      }
      const user = await deps.getUser(req.session.userId!);
      if (isStaffRole(user?.role)) {
        return res.status(403).json(emptyInvoiceDetail({ configured, enabled, linked: false }));
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: false }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: true, notFound: true }));
      }
      const detail = await load(invoiceId, clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...detail });
    } catch {
      return res.json(emptyInvoiceDetail({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}

/**
 * Admin customer-detail view: a single invoice's full detail for any linked
 * customer. The client id is the SELECTED user's linked client (resolved from
 * the :id path param), so the same ownership check applies — an admin still
 * can't read an invoice that doesn't belong to the customer they're viewing.
 * Read-only contract: degrades to a stable unreachable state instead of 500.
 */
export function createAdminInvoiceDetailHandler(deps: InvoiceDetailRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const invoiceId = Number(getParam(req, "invoiceId"));
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: !!clientId }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: true, notFound: true }));
      }
      const detail = await load(invoiceId, clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...detail });
    } catch {
      return res.json(emptyInvoiceDetail({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}
