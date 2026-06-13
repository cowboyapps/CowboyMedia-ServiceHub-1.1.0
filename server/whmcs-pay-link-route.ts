import type { Request, Response } from "express";
import { getParam } from "./http-params";
import { isStaffRole } from "./roles";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  createSsoToken as defaultCreateSsoToken,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadInvoiceDetail as defaultLoadInvoiceDetail,
  loadBillingSummary as defaultLoadBillingSummary,
  buildInvoicePayPath,
  type InvoiceDetailData,
  type BillingSummaryData,
} from "./whmcs-billing";

// Handler factories for the seamless (SSO) WHMCS pay-link endpoints:
//   POST /api/billing/invoices/:invoiceId/pay-link   (settle one invoice)
//   POST /api/billing/pay-all-link                   (settle every outstanding)
//
// Each mints a SINGLE-USE WHMCS auto-login URL (CreateSsoToken) that drops the
// linked customer straight onto WHMCS's hosted payment page already signed in —
// no second login wall. The WHMCS client id is ALWAYS resolved from the SESSION
// user (never request input); the single-invoice route additionally ownership-
// checks the invoice via loadInvoiceDetail before minting, and the pay-all route
// derives the outstanding id set server-side from the customer's own summary, so
// a customer can only ever pay their OWN invoices.
//
// Fail-closed contract: any failure (WHMCS unconfigured/disabled, account not
// linked, invoice not theirs, WHMCS unreachable, or SSO disabled/unsupported)
// responds with a non-2xx + `{ fallback: true }` so the frontend silently falls
// back to the plain `viewinvoice.php` deep link — payment is never a dead end.
// The minted `url` is a one-time login credential and is NEVER logged.

export interface PayLinkRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface PayLinkRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface PayLinkRouteDeps {
  getWhmcsSettings: () => Promise<PayLinkRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<PayLinkRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  loadInvoiceDetail?: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<InvoiceDetailData>;
  /** Defaults to the real loader; injectable for tests. */
  loadBillingSummary?: (clientId: number, baseUrl: string | null) => Promise<BillingSummaryData>;
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
 * Customer self-action: mint a single-use seamless pay link for ONE of the
 * logged-in user's OWN invoices. Ownership is enforced exactly like the invoice
 * detail / PDF reads — loadInvoiceDetail rejects any invoice whose owning client
 * doesn't match the session user's linked client (notFound). Fails closed with
 * `{ fallback: true }` on every non-success path; never 500s.
 */
export function createCustomerPayLinkHandler(deps: PayLinkRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const loadInvoiceDetail = deps.loadInvoiceDetail ?? defaultLoadInvoiceDetail;
  const createSso = deps.createSsoToken ?? defaultCreateSsoToken;
  return async (req: Request, res: Response) => {
    try {
      const invoiceId = Number(getParam(req, "invoiceId"));
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.status(404).json({ message: "Invoice not found", fallback: true });
      }
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(503).json({ message: "Online billing isn't available right now.", fallback: true });
      }
      const user = await deps.getUser(req.session.userId!);
      if (isStaffRole(user?.role)) {
        return res.status(403).json({ message: "Staff accounts can't use customer payment links.", fallback: true });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ message: "Your account isn't linked to billing yet.", fallback: true });
      }
      const detail = await loadInvoiceDetail(invoiceId, clientId, baseUrl);
      if (detail.unreachable) {
        return res.status(502).json({ message: "Billing is temporarily unavailable.", fallback: true });
      }
      if (detail.notFound || !detail.invoice) {
        return res.status(404).json({ message: "Invoice not found", fallback: true });
      }
      const path = buildInvoicePayPath([invoiceId]);
      if (!path) {
        return res.status(404).json({ message: "Invoice not found", fallback: true });
      }
      const url = extractSsoUrl(await createSso(clientId, path));
      if (!url) {
        return res.status(502).json({ message: "Couldn't start a secure payment session.", fallback: true });
      }
      return res.json({ ok: true, url });
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable.", fallback: true });
    }
  };
}

/**
 * Customer self-action: mint a single-use seamless pay link covering EVERY one
 * of the logged-in user's outstanding (unpaid + overdue) invoices. The id set is
 * derived server-side from the customer's OWN summary (never request input), so
 * a customer can only ever bundle their own invoices. Fails closed with
 * `{ fallback: true }` on every non-success path; never 500s.
 */
export function createCustomerPayAllLinkHandler(deps: PayLinkRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const loadSummary = deps.loadBillingSummary ?? defaultLoadBillingSummary;
  const createSso = deps.createSsoToken ?? defaultCreateSsoToken;
  return async (req: Request, res: Response) => {
    try {
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(503).json({ message: "Online billing isn't available right now.", fallback: true });
      }
      const user = await deps.getUser(req.session.userId!);
      if (isStaffRole(user?.role)) {
        return res.status(403).json({ message: "Staff accounts can't use customer payment links.", fallback: true });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ message: "Your account isn't linked to billing yet.", fallback: true });
      }
      const summary = await loadSummary(clientId, baseUrl);
      if (summary.unreachable) {
        return res.status(502).json({ message: "Billing is temporarily unavailable.", fallback: true });
      }
      const outstandingIds = summary.invoices
        .filter((inv) => inv.status === "unpaid" || inv.status === "overdue")
        .map((inv) => inv.id);
      const path = buildInvoicePayPath(outstandingIds);
      if (!path) {
        return res.status(404).json({ message: "No outstanding invoices to pay.", fallback: true });
      }
      const url = extractSsoUrl(await createSso(clientId, path));
      if (!url) {
        return res.status(502).json({ message: "Couldn't start a secure payment session.", fallback: true });
      }
      return res.json({ ok: true, url });
    } catch {
      return res.status(503).json({ message: "Billing system is temporarily unavailable.", fallback: true });
    }
  };
}
