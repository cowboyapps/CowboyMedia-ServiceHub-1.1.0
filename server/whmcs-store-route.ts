import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  addOrder as defaultAddOrder,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadPaymentMethods as defaultLoadPaymentMethods,
  buildInvoicePayUrl,
  extractInvoiceId,
  type StoreCatalogueData,
  type StoreCatalogueProduct,
  type PaymentMethodsData,
} from "./whmcs-billing";
import { isUnlinkedStaff } from "./roles";
import { placeProductOrderSchema } from "@shared/schema";

// Handler factories for the customer storefront endpoints (Task #518):
//   GET  /api/billing/store-products  — the admin-curated product catalogue
//   POST /api/billing/store-order     — place a new product order (with config
//                                       options + custom fields)
//
// These mirror the in-app ordering endpoints (createListOrderableProductsHandler
// / createPlaceOrderHandler) but read the ADMIN-CURATED storefront catalogue
// instead of the service mapping allowlist, and carry the product's configurable
// options + custom field answers through to AddOrder. Same security contracts:
//   1. Ownership — the WHMCS client id is ALWAYS resolved from the SESSION user.
//      Unlinked staff are blocked. The order is placed for that client only.
//   2. Validity — the product id, billing cycle, configurable options, and custom
//      fields are validated against the live curated catalogue before any write.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the response carries the new invoice id + pay URL for the existing
//      single-use SSO pay handoff.

export interface StoreRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface StoreRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface StoreRouteDeps {
  getWhmcsSettings: () => Promise<StoreRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<StoreRouteUser | null | undefined>;
  /** Loads the admin-curated catalogue merged with the live WHMCS data. Required. */
  loadStoreCatalogue: () => Promise<StoreCatalogueData>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real payment-method loader; injectable for tests. */
  loadPaymentMethods?: () => Promise<PaymentMethodsData>;
  /** Defaults to the real AddOrder writer; injectable for tests. */
  addOrder?: (input: {
    clientId: number;
    pid: number;
    billingCycle: string;
    paymentMethod: string;
    configOptions?: Record<number, number>;
    customFields?: Record<number, string>;
  }) => Promise<WhmcsRawFetch>;
  /** Best-effort hook to track the order for the "service ready" notifier. */
  recordPendingOrder?: (userId: string, pid: number, invoiceId: number | null) => Promise<void>;
}

async function resolveAvailability(deps: StoreRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const settings = await deps.getWhmcsSettings();
  const baseUrl = normalize(settings?.baseUrl ?? null);
  const configured = credentials() && !!baseUrl;
  const enabled = !!settings?.enabled;
  return { configured, enabled, baseUrl };
}

/**
 * Validate the customer's configurable-option + custom-field answers against the
 * product's live catalogue definition, returning the clean maps to send to
 * AddOrder. Unknown ids are dropped; invalid choices / missing required answers
 * are rejected. Pure → unit-tested.
 */
export function validateStoreOrderInputs(
  product: StoreCatalogueProduct,
  configInput: Record<string, number> | undefined,
  customInput: Record<string, string> | undefined,
): { ok: true; configOptions: Record<number, number>; customFields: Record<number, string> } | { ok: false; message: string } {
  const configOptions: Record<number, number> = {};
  for (const opt of product.configOptions) {
    const provided = configInput?.[String(opt.id)];
    if (opt.type === "dropdown" || opt.type === "radio") {
      if (provided === undefined) {
        if (opt.required) return { ok: false, message: `Please choose an option for "${opt.name}".` };
        continue;
      }
      if (!opt.choices.some((c) => c.id === provided)) {
        return { ok: false, message: `That isn't a valid choice for "${opt.name}".` };
      }
      configOptions[opt.id] = provided;
    } else {
      // quantity / yesno: a value of 0 means "none"; only send positive values.
      if (provided === undefined) continue;
      if (provided < 0) return { ok: false, message: `That isn't a valid value for "${opt.name}".` };
      if (provided > 0) configOptions[opt.id] = provided;
    }
  }
  const customFields: Record<number, string> = {};
  for (const field of product.customFields) {
    const provided = (customInput?.[String(field.id)] ?? "").trim();
    if (!provided) {
      if (field.required) return { ok: false, message: `Please fill in "${field.name}".` };
      continue;
    }
    if (field.fieldType === "dropdown" && field.options.length > 0 && !field.options.includes(provided)) {
      return { ok: false, message: `That isn't a valid value for "${field.name}".` };
    }
    customFields[field.id] = provided;
  }
  return { ok: true, configOptions, customFields };
}

/**
 * Customer self-view: the admin-curated storefront catalogue. Locked shape
 * `{ configured, enabled, linked, unreachable, hasGateway, products }` so the
 * frontend never branches on missing keys. Browsing doesn't require a linked
 * account (the UI prompts to link); unlinked staff are blocked. Never 500s.
 */
export function createListStoreProductsHandler(deps: StoreRouteDeps) {
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const empty = (over: Partial<{ configured: boolean; enabled: boolean; linked: boolean }> = {}) => ({
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    hasGateway: false,
    products: [] as StoreCatalogueData["products"],
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

      const [catalogue, methods] = await Promise.all([deps.loadStoreCatalogue(), loadMethods()]);
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
 * Customer self-action: place a new storefront product order for the logged-in
 * user's OWN linked client. The client id is ALWAYS derived from the session
 * user. The product, cycle, configurable options, and custom fields are all
 * validated against the live curated catalogue before AddOrder. Never 500s.
 */
export function createPlaceProductOrderHandler(deps: StoreRouteDeps) {
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const submit = deps.addOrder ?? defaultAddOrder;
  return async (req: Request, res: Response) => {
    try {
      const parsed = placeProductOrderSchema.safeParse(req.body ?? {});
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

      // Validity gate: the product must exist in the curated catalogue AND offer
      // the requested cycle. A bad/disabled combo is rejected before any write.
      const catalogue = await deps.loadStoreCatalogue();
      if (catalogue.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const product = catalogue.products.find((p) => p.pid === parsed.data.pid);
      if (!product || !product.cycles.some((c) => c.cycle === parsed.data.billingCycle)) {
        return res.status(404).json({ ok: false, message: "That product or billing cycle isn't available." });
      }

      // Validate the configurable-option + custom-field answers against the live
      // product definition before any write.
      const inputs = validateStoreOrderInputs(product, parsed.data.configOptions, parsed.data.customFields);
      if (!inputs.ok) {
        return res.status(400).json({ ok: false, message: inputs.message });
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
        configOptions: inputs.configOptions,
        customFields: inputs.customFields,
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

      if (deps.recordPendingOrder) {
        try {
          await deps.recordPendingOrder(req.session.userId!, parsed.data.pid, invoiceId);
        } catch {
          /* pending-order tracking is best-effort; ignore */
        }
      }

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
