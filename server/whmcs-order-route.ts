import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  addOrder as defaultAddOrder,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadOrderableProducts as defaultLoadOrderableProducts,
  loadPaymentMethods as defaultLoadPaymentMethods,
  buildInvoicePayUrl,
  extractInvoiceId,
  type OrderableProductsData,
  type PaymentMethodsData,
} from "./whmcs-billing";
import { isUnlinkedStaff } from "./roles";
import { placeOrderSchema } from "@shared/schema";

// Handler factories for the customer in-app ordering endpoints:
//   GET  /api/billing/products   — the orderable product catalogue
//   POST /api/billing/order      — place a new product order
//
// Extracted from registerRoutes so the security-critical contracts can be
// unit-tested directly against the production handlers (same pattern as
// createRequestCancellationHandler). Placing an order is a customer-initiated
// WHMCS WRITE, so it degrades exactly like the read-only billing features when
// WHMCS is unconfigured/unreachable, the account isn't linked, or there is no
// payment gateway.
//
// Contracts:
//   1. Ownership — the WHMCS client id is ALWAYS resolved from the SESSION user
//      (never request input). Unlinked staff are blocked. The order is placed for
//      that client only.
//   2. Validity — the product id + billing cycle in the body must exist in the
//      live catalogue and be offered, or the order is rejected before any write.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the response carries the new invoice id + a pay URL so the
//      frontend can hand off to the existing single-use SSO pay flow.

export interface OrderRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface OrderRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface OrderRouteDeps {
  getWhmcsSettings: () => Promise<OrderRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<OrderRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real catalogue loader; injectable for tests. */
  loadOrderableProducts?: () => Promise<OrderableProductsData>;
  /** Defaults to the real payment-method loader; injectable for tests. */
  loadPaymentMethods?: () => Promise<PaymentMethodsData>;
  /** Defaults to the real AddOrder writer; injectable for tests. */
  addOrder?: (input: {
    clientId: number;
    pid: number;
    billingCycle: string;
    paymentMethod: string;
  }) => Promise<WhmcsRawFetch>;
}

/**
 * Resolve {configured, enabled} from settings + credentials, mirroring the rest
 * of the billing routes so the gating is identical everywhere.
 */
async function resolveAvailability(deps: OrderRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const settings = await deps.getWhmcsSettings();
  const baseUrl = normalize(settings?.baseUrl ?? null);
  const configured = credentials() && !!baseUrl;
  const enabled = !!settings?.enabled;
  return { configured, enabled, baseUrl };
}

/**
 * Customer self-view: the orderable product catalogue. Locked shape
 * `{ configured, enabled, linked, unreachable, hasGateway, products }` so the
 * frontend never branches on missing keys. Browsing doesn't require a linked
 * account (the UI prompts to link), but unlinked staff are blocked. Never 500s.
 */
export function createListOrderableProductsHandler(deps: OrderRouteDeps) {
  const loadProducts = deps.loadOrderableProducts ?? (() => defaultLoadOrderableProducts());
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const empty = (over: Partial<{ configured: boolean; enabled: boolean; linked: boolean }> = {}) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    hasGateway: false,
    products: [] as OrderableProductsData["products"],
    ...over,
  });
  return async (req: Request, res: Response) => {
    try {
      const { configured, enabled } = await resolveAvailability(deps);
      if (!configured || !enabled) return res.json(empty({ configured, enabled }));

      const user = await deps.getUser(req.session.userId!);
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ ...empty({ configured, enabled }), message: "Staff accounts can't use customer billing actions." });
      }
      const linked = !!user?.whmcsClientId;

      const [catalogue, methods] = await Promise.all([loadProducts(), loadMethods()]);
      if (catalogue.unreachable) {
        return res.json(empty({ configured, enabled, linked }));
      }
      return res.json({
        configured,
        enabled,
        linked,
        unreachable: false,
        hasGateway: !methods.unreachable && methods.methods.length > 0,
        products: catalogue.products,
      });
    } catch {
      return res.json(empty({ configured: true, enabled: true }));
    }
  };
}

/**
 * Customer self-action: place a new product order for the logged-in user's OWN
 * linked client. The client id is ALWAYS derived from the session user. The
 * product id + cycle are validated against the live catalogue before AddOrder, a
 * valid payment gateway is selected from WHMCS's own list (friendly error when
 * none), and on success the new invoice id + a pay URL are returned so the
 * frontend can hand off to the existing SSO pay flow. Never 500s.
 */
export function createPlaceOrderHandler(deps: OrderRouteDeps) {
  const loadProducts = deps.loadOrderableProducts ?? (() => defaultLoadOrderableProducts());
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const submit = deps.addOrder ?? defaultAddOrder;
  return async (req: Request, res: Response) => {
    try {
      const parsed = placeOrderSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
      }

      const { configured, enabled, baseUrl } = await resolveAvailability(deps);
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Ordering isn't available right now." });
      }

      const user = await deps.getUser(req.session.userId!);
      if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
        return res.status(403).json({ ok: false, message: "Staff accounts can't use customer billing actions." });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ ok: false, message: "Your account isn't linked to billing yet." });
      }

      // Validity gate: the product must exist in the live catalogue AND offer the
      // requested cycle. A bad/disabled combo is rejected before any write.
      const catalogue = await loadProducts();
      if (catalogue.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const product = catalogue.products.find((p) => p.pid === parsed.data.pid);
      if (!product || !product.cycles.some((c) => c.cycle === parsed.data.billingCycle)) {
        return res.status(404).json({ ok: false, message: "That product or billing cycle isn't available." });
      }

      // AddOrder REQUIRES a payment method — pick the first active gateway.
      const methods = await loadMethods();
      if (methods.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const gateway = methods.methods[0]?.module;
      if (!gateway) {
        return res.status(409).json({ ok: false, message: "Online ordering isn't available right now because no payment method is set up. Please contact support." });
      }

      const result = await submit({
        clientId,
        pid: parsed.data.pid,
        billingCycle: parsed.data.billingCycle,
        paymentMethod: gateway,
      });
      if (!result.ok) {
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : "Couldn't place your order right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      const invoiceId = extractInvoiceId(result.data);
      const payUrl = invoiceId ? buildInvoicePayUrl(baseUrl, invoiceId) : null;
      return res.json({
        ok: true,
        message: "Your order has been placed.",
        invoiceId,
        payUrl,
      });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't place your order right now. Please try again shortly." });
    }
  };
}
