import type { Request, Response } from "express";
import { getParam } from "./http-params";
import { hasWhmcsCredentials, normalizeBaseUrl } from "./whmcs";
import { loadInvoiceServiceHint as defaultLoadInvoiceServiceHint, type InvoiceServiceHintData } from "./whmcs-billing";
import { isUnlinkedStaff } from "./roles";

// Handler factories for the per-invoice renewed-service lookup endpoints:
//   GET /api/billing/invoices/:invoiceId/service                        (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/service  (admin)
//
// These are the LAZY twin of the up-front invoice-list service labelling
// (Task #426). The combined billing payload only labels the first
// TXN_SERVICE_INVOICE_CAP invoices to bound the WHMCS fan-out; for a customer
// with a long billing history, the frontend lazily fetches the renewed-service
// label for older rows here, only when a row scrolls into view. Same ownership
// contract as the invoice-detail route: the WHMCS client id is ALWAYS resolved
// from the SESSION user (customer) / SELECTED user (admin) — never request
// input — and loadInvoiceServiceHint collapses a foreign invoice to a clean
// not-found (no enumeration oracle). Both handlers are READ-ONLY and the
// customer handler NEVER 500s — every failure degrades to a stable JSON shape.

export interface InvoiceServiceRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface InvoiceServiceRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface InvoiceServiceRouteDeps {
  getWhmcsSettings: () => Promise<InvoiceServiceRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<InvoiceServiceRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  loadInvoiceServiceHint?: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<InvoiceServiceHintData>;
}

/** The locked degraded shape every invoice-service response carries. */
export function emptyInvoiceService(over: Record<string, unknown>) {
  return {
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    notFound: false,
    service: null,
    ...over,
  };
}

/**
 * Customer self-view: the single hosting service one invoice renewed, scoped to
 * the logged-in user's OWN linked WHMCS client. The client id is ALWAYS derived
 * from the session user — never request input. Never 500s; degrades to a clean
 * disabled / unlinked / unreachable / notFound state.
 */
export function createCustomerInvoiceServiceHandler(deps: InvoiceServiceRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceServiceHint ?? defaultLoadInvoiceServiceHint;
  return async (req: Request, res: Response) => {
    try {
      const invoiceId = Number(getParam(req, "invoiceId"));
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyInvoiceService({ configured, enabled }));
      }
      const user = await deps.getUser(req.session.userId!);
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json(emptyInvoiceService({ configured, enabled, linked: false }));
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyInvoiceService({ configured, enabled, linked: false }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceService({ configured, enabled, linked: true, notFound: true }));
      }
      const hint = await load(invoiceId, clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...hint });
    } catch {
      return res.json(emptyInvoiceService({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}

/**
 * Admin customer-detail view: the single hosting service one invoice renewed,
 * for any linked customer. The client id is the SELECTED user's linked client
 * (resolved from the :id path param), so the same ownership check applies — an
 * admin still can't read an invoice that doesn't belong to the customer they're
 * viewing. Read-only contract: degrades to a stable unreachable state instead
 * of 500.
 */
export function createAdminInvoiceServiceHandler(deps: InvoiceServiceRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceServiceHint ?? defaultLoadInvoiceServiceHint;
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
        return res.json(emptyInvoiceService({ configured, enabled, linked: !!clientId }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceService({ configured, enabled, linked: true, notFound: true }));
      }
      const hint = await load(invoiceId, clientId, baseUrl);
      return res.json({ configured, enabled, linked: true, ...hint });
    } catch {
      return res.json(emptyInvoiceService({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}
