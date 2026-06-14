import type { Request, Response } from "express";
import { getParam } from "./http-params";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  createSsoToken as defaultCreateSsoToken,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadInvoiceDetail as defaultLoadInvoiceDetail,
  buildInvoicePdfUrl,
  buildInvoicePdfPath,
  type InvoiceDetailData,
} from "./whmcs-billing";
import { getErrorMessage } from "./error-utils";
import { isUnlinkedStaff } from "./roles";

// Handler factories for the invoice-PDF download endpoints:
//   GET /api/billing/invoices/:invoiceId/pdf                         (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf   (admin)
//
// WHMCS has NO API action that returns invoice PDF bytes (the old code called a
// non-existent "GetInvoicePDF" action, which is why downloads failed in prod).
// Instead we mint a SINGLE-USE auto-login URL (CreateSsoToken with
// sso:custom_redirect) that lands the linked client straight on WHMCS's own
// rendered PDF at `dl.php?type=i&id=<id>` — no second login wall — and 302 the
// browser to it. This mirrors the seamless pay-link route exactly.
//
// Ownership: the WHMCS client id is ALWAYS resolved from the session (customer
// route) or the SELECTED user (admin route), never request input, and the
// invoice is ownership-checked via loadInvoiceDetail before any token is minted
// (loadInvoiceDetail collapses "not yours" and "doesn't exist" into notFound, so
// no enumeration oracle). WHMCS itself re-enforces ownership after SSO login.
//
// Fail-soft: if SSO can't be minted (disabled for the API role, older WHMCS, or
// any error) OR the ownership read is unreachable, we redirect to the plain
// (login-walled) WHMCS PDF link instead of erroring — PDF access is never a dead
// end. Hard-deny paths (invalid id, unconfigured/disabled, unlinked, staff, not
// found / not theirs) still return a clean 404/403 and never leak. The minted
// URL is a one-time login credential and is NEVER logged.

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
  /** Defaults to the real WHMCS SSO call; injectable for tests. */
  createSsoToken?: (clientId: number, redirectPath: string) => Promise<WhmcsRawFetch>;
}

/** Pull the one-time redirect URL out of a CreateSsoToken result, or null. */
function extractSsoUrl(result: WhmcsRawFetch): string | null {
  if (!result.ok) return null;
  const url = result.data?.redirect_url;
  return typeof url === "string" && url.length > 0 ? url : null;
}

/**
 * Customer invoice-PDF download. Mints a single-use SSO redirect to the official
 * WHMCS PDF link for ONE of the logged-in user's OWN invoices and 302s to it, so
 * the customer never hits a WHMCS login wall. Ownership is enforced exactly like
 * the invoice-detail read (loadInvoiceDetail rejects any invoice whose owning
 * client doesn't match → notFound). Falls back to the plain WHMCS PDF link when
 * SSO can't be minted or the read is unreachable; never 500s.
 */
export function createInvoicePdfHandler(deps: InvoicePdfRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  const createSso = deps.createSsoToken ?? defaultCreateSsoToken;
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
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ message: "Staff accounts can't download customer invoices." });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      // Plain (login-walled) WHMCS PDF link — the graceful fallback target.
      const fallbackUrl = buildInvoicePdfUrl(baseUrl, invoiceId);
      const detail = await load(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        // Can't verify ownership right now; send them to the login-walled link
        // (WHMCS re-checks ownership after login) instead of a dead end.
        if (fallbackUrl) return res.redirect(fallbackUrl);
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const path = buildInvoicePdfPath(invoiceId);
      const ssoUrl = path ? extractSsoUrl(await createSso(clientId, path)) : null;
      const target = ssoUrl ?? fallbackUrl;
      if (!target) {
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      return res.redirect(target);
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable" });
    }
  };
}

/**
 * Admin invoice-PDF download for a linked customer. Permission-gated; ownership
 * enforced against the SELECTED user's linked client id (same guard as the
 * customer route). Mints an SSO redirect to the customer's official WHMCS PDF
 * link and 302s to it, with the same plain-link fallback. MAY surface the
 * underlying error message (it's admin-only, not customer-facing).
 */
export function createAdminInvoicePdfHandler(deps: InvoicePdfRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  const createSso = deps.createSsoToken ?? defaultCreateSsoToken;
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
      const fallbackUrl = buildInvoicePdfUrl(baseUrl, invoiceId);
      const detail = await load(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        if (fallbackUrl) return res.redirect(fallbackUrl);
        return res.status(502).json({ message: "Could not download this invoice right now. Please try again shortly." });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found" });
      }
      const path = buildInvoicePdfPath(invoiceId);
      const ssoUrl = path ? extractSsoUrl(await createSso(clientId, path)) : null;
      const target = ssoUrl ?? fallbackUrl;
      if (!target) {
        return res.status(502).json({ message: "Could not download this invoice right now." });
      }
      return res.redirect(target);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
