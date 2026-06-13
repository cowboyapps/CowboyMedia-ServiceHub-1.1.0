import type { Request, Response } from "express";
import { getParam } from "./http-params";
import { hasWhmcsCredentials, normalizeBaseUrl, getInvoicePdf as defaultGetInvoicePdf, type WhmcsInvoicePdfDownload } from "./whmcs";
import { loadInvoiceDetail as defaultLoadInvoiceDetail, type InvoiceDetailData } from "./whmcs-billing";
import { getErrorMessage } from "./error-utils";
import { isStaffRole } from "./roles";

// Handler factories for the invoice-PDF download proxies (Task #373):
//   GET /api/billing/invoices/:invoiceId/pdf                         (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf   (admin)
//
// Extracted from registerRoutes so the security-critical contract can be unit-
// tested directly against the production handler (same pattern as
// createCustomerInvoiceDetailHandler in server/whmcs-invoice-detail-route.ts).
// The proxy streams a single invoice's official WHMCS PDF through ServiceHub so
// the customer never gets bounced to a WHMCS client-area login. Ownership is
// enforced exactly like the invoice-detail read (loadInvoiceDetail rejects any
// invoice whose owning client doesn't match), so a customer can't pull another
// client's PDF by guessing an id. The customer route additionally rejects staff
// accounts (Task #439). Failures degrade cleanly: 404 (not found / unconfigured
// / unlinked / ownership mismatch), 502 (WHMCS unreachable or PDF fetch failed),
// 503/500 (unexpected throw) — never a leak.

export interface InvoicePdfRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface InvoicePdfRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface InvoicePdfRouteDeps {
  getWhmcsSettings: () => Promise<InvoicePdfRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<InvoicePdfRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  loadInvoiceDetail?: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<InvoiceDetailData>;
  /** Defaults to the real PDF fetch; injectable for tests. */
  getInvoicePdf?: (invoiceId: number) => Promise<WhmcsInvoicePdfDownload>;
}

function streamPdf(res: Response, req: Request, invoiceId: number, data: string): void {
  const buffer = Buffer.from(data, "base64");
  const disposition = req.query.download === "1" ? "attachment" : "inline";
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `${disposition}; filename="invoice-${invoiceId}.pdf"`);
  res.set("Cache-Control", "private, max-age=300");
  res.send(buffer);
}

/**
 * Customer invoice-PDF download proxy. Streams a single invoice's official WHMCS
 * PDF through ServiceHub (mirror-on-read — nothing stored) so the customer never
 * has to log into the WHMCS client area to read it. Ownership is enforced exactly
 * like the invoice detail read: loadInvoiceDetail rejects any invoice whose
 * owning client doesn't match the session user's linked client (returns
 * notFound), so a customer can't pull another client's PDF by guessing its id.
 * Never 500s — degrades to a clean 404 / 502 / 503.
 */
export function createInvoicePdfHandler(deps: InvoicePdfRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  const fetchPdf = deps.getInvoicePdf ?? defaultGetInvoicePdf;
  return async (req: Request, res: Response) => {
    try {
      const invoiceId = Number(getParam(req, "invoiceId"));
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const user = await deps.getUser(req.session.userId!);
      if (isStaffRole(user?.role)) {
        return res.status(403).json({ message: "Staff accounts can't download customer invoices." });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const detail = await load(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const dl = await fetchPdf(invoiceId);
      if (!dl.ok || !dl.data) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      return streamPdf(res, req, invoiceId, dl.data);
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  };
}

/**
 * Admin invoice-PDF download proxy for a linked customer. Permission-gated;
 * ownership enforced against the SELECTED user's linked client id (same guard as
 * the customer route). Streams the PDF bytes through — nothing is stored. MAY
 * surface the underlying error message (it's admin-only, not customer-facing).
 */
export function createAdminInvoicePdfHandler(deps: InvoicePdfRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  const fetchPdf = deps.getInvoicePdf ?? defaultGetInvoicePdf;
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "Invoice not found" });
      const invoiceId = Number(getParam(req, "invoiceId"));
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      const clientId = user.whmcsClientId ?? null;
      if (!configured || !enabled || !clientId) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const detail = await load(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const dl = await fetchPdf(invoiceId);
      if (!dl.ok || !dl.data) {
        return res.status(502).json({ message: `Could not download this invoice: ${dl.error ?? "unknown error"}` });
      }
      return streamPdf(res, req, invoiceId, dl.data);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
