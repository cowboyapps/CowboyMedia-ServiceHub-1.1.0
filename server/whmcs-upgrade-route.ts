import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  upgradeProduct as defaultUpgradeProduct,
  getOrders as defaultGetOrders,
  type WhmcsRawFetch,
} from "./whmcs";
import {
  loadServicesList as defaultLoadServicesList,
  loadOrderableProducts as defaultLoadOrderableProducts,
  loadPaymentMethods as defaultLoadPaymentMethods,
  buildInvoicePayUrl,
  parseUpgradeCalc,
  cycleKeyFromLabel,
  extractInvoiceId,
  extractOrderId,
  extractInvoiceIdFromOrders,
  type ServicesListData,
  type OrderableProductsData,
  type PaymentMethodsData,
  type OrderBillingCycle,
} from "./whmcs-billing";
import { getParam } from "./http-params";
import { isUnlinkedStaff } from "./roles";
import { submitUpgradeSchema } from "@shared/schema";

// Handler factories for the customer in-app upgrade/change-plan endpoints:
//   GET  /api/billing/services/:serviceId/upgrade-options
//   POST /api/billing/services/:serviceId/upgrade
//
// Extracted from registerRoutes so the security-critical ownership check can be
// unit-tested directly against the production handlers (same pattern as the
// cancel route). Submitting an upgrade is a customer-initiated WHMCS WRITE.
//
// Contracts:
//   1. Ownership — the WHMCS client id is ALWAYS resolved from the SESSION user;
//      the target service id (path) must belong to that client, and the chosen
//      upgrade target must be a real product in the SAME group as the current
//      one, before any write. Unlinked staff are blocked.
//   2. Never 500s — every failure degrades to a stable tagged JSON shape; on a
//      successful submit the response carries the resulting invoice id + a pay
//      URL so the frontend hands off to the existing single-use SSO pay flow.

export interface UpgradeRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface UpgradeRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface UpgradeRouteDeps {
  getWhmcsSettings: () => Promise<UpgradeRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<UpgradeRouteUser | null | undefined>;
  hasWhmcsCredentials?: () => boolean;
  normalizeBaseUrl?: (raw: string | null) => string | null;
  loadServicesList?: (clientId: number) => Promise<ServicesListData>;
  loadOrderableProducts?: () => Promise<OrderableProductsData>;
  loadPaymentMethods?: () => Promise<PaymentMethodsData>;
  /** UpgradeProduct with calconly — quotes the prorated price; injectable. */
  calcUpgrade?: (serviceId: number, newProductId: number, billingCycle: string) => Promise<WhmcsRawFetch>;
  /** UpgradeProduct (real submit); injectable. */
  submitUpgrade?: (serviceId: number, newProductId: number, billingCycle: string, paymentMethod: string) => Promise<WhmcsRawFetch>;
  /** GetOrders to resolve the upgrade invoice id; injectable. */
  getOrders?: (orderId: number) => Promise<WhmcsRawFetch>;
}

interface ResolvedContext {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
}

async function resolveAvailability(deps: UpgradeRouteDeps): Promise<ResolvedContext> {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const settings = await deps.getWhmcsSettings();
  const baseUrl = normalize(settings?.baseUrl ?? null);
  return { configured: credentials() && !!baseUrl, enabled: !!settings?.enabled, baseUrl };
}

/**
 * Resolve the session user, the active WHMCS service the route targets, and the
 * caller's linked client id — running the shared ownership/availability gates.
 * Returns either an error response (already sent) or the resolved bits.
 */
async function resolveOwnedService(
  deps: UpgradeRouteDeps,
  req: Request,
  res: Response,
  loadServices: (clientId: number) => Promise<ServicesListData>,
): Promise<{ clientId: number; service: ServicesListData["services"][number] } | null> {
  const serviceId = Number(getParam(req, "serviceId"));
  if (!Number.isInteger(serviceId) || serviceId <= 0) {
    res.status(404).json({ ok: false, message: "That service couldn't be found on your account." });
    return null;
  }
  const user = await deps.getUser(req.session.userId!);
  if (isUnlinkedStaff(user?.role, user?.whmcsClientId)) {
    res.status(403).json({ ok: false, message: "Staff accounts can't use customer billing actions." });
    return null;
  }
  const clientId = user?.whmcsClientId ?? null;
  if (!clientId) {
    res.status(409).json({ ok: false, message: "Your account isn't linked to billing yet." });
    return null;
  }
  const list = await loadServices(clientId);
  if (list.unreachable) {
    res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
    return null;
  }
  const service = list.services.find((s) => s.id === serviceId);
  if (!service) {
    res.status(404).json({ ok: false, message: "That service couldn't be found on your account." });
    return null;
  }
  return { clientId, service };
}

/**
 * Customer self-view: the valid upgrade/downgrade targets for one of the caller's
 * OWN services, each with a price (the prorated WHMCS calc when available, else
 * the new recurring price). Candidates are the OTHER products in the current
 * product's group. Never 500s; degrades to a tagged shape on every failure.
 */
export function createUpgradeOptionsHandler(deps: UpgradeRouteDeps) {
  const loadServices = deps.loadServicesList ?? defaultLoadServicesList;
  const loadProducts = deps.loadOrderableProducts ?? (() => defaultLoadOrderableProducts());
  const calc = deps.calcUpgrade ?? ((serviceId, pid, cycle) => defaultUpgradeProduct({ serviceId, newProductId: pid, billingCycle: cycle, calcOnly: true }));
  return async (req: Request, res: Response) => {
    try {
      const { configured, enabled } = await resolveAvailability(deps);
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Plan changes aren't available right now." });
      }
      const owned = await resolveOwnedService(deps, req, res, loadServices);
      if (!owned) return;
      const { service } = owned;
      if (service.status.toLowerCase() !== "active") {
        return res.status(409).json({ ok: false, message: "Only active services can be changed." });
      }

      const catalogue = await loadProducts();
      if (catalogue.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const current = catalogue.products.find((p) => p.pid === service.pid);
      // Without the current product in the catalogue we can't determine its group,
      // so there are no upgrade targets to offer — return an empty (not error) set.
      const candidates = current
        ? catalogue.products.filter((p) => p.gid === current.gid && p.pid !== current.pid)
        : [];

      const currentCycleKey = cycleKeyFromLabel(service.billingCycle);
      const options = [];
      for (const cand of candidates) {
        // Quote at the current term when the candidate offers it, else its first.
        const chosen =
          (currentCycleKey && cand.cycles.find((c) => c.cycle === currentCycleKey)) || cand.cycles[0];
        if (!chosen) continue;
        // Best-effort prorated price from WHMCS; null falls back to the new price.
        let proratedPrice: string | null = null;
        try {
          const calcRes = await calc(service.id, cand.pid, chosen.cycle);
          if (calcRes.ok) proratedPrice = parseUpgradeCalc(calcRes.data).price;
        } catch {
          // Leave proratedPrice null — the new recurring price still shows.
        }
        options.push({
          pid: cand.pid,
          name: cand.name,
          billingCycle: chosen.cycle as OrderBillingCycle,
          billingCycleLabel: chosen.label,
          price: chosen.price,
          setupFee: chosen.setupFee,
          proratedPrice,
        });
      }

      return res.json({
        ok: true,
        currentProductId: current?.pid ?? service.pid,
        currentName: service.name,
        currentAmount: service.amount,
        currentBillingCycle: service.billingCycle,
        currency: current?.currency ?? null,
        options,
      });
    } catch {
      return res.status(502).json({ ok: false, message: "We couldn't load plan options right now. Please try again shortly." });
    }
  };
}

/**
 * Customer self-action: submit an upgrade/downgrade for one of the caller's OWN
 * services. Ownership is resolved from the session; the chosen target must be a
 * real product in the same group as the current one and offer the chosen cycle.
 * On success WHMCS creates the upgrade invoice — its id (resolved directly or via
 * the order) + a pay URL are returned for the SSO pay handoff. Never 500s.
 */
export function createSubmitUpgradeHandler(deps: UpgradeRouteDeps) {
  const loadServices = deps.loadServicesList ?? defaultLoadServicesList;
  const loadProducts = deps.loadOrderableProducts ?? (() => defaultLoadOrderableProducts());
  const loadMethods = deps.loadPaymentMethods ?? (() => defaultLoadPaymentMethods());
  const submit = deps.submitUpgrade ?? ((serviceId, pid, cycle, method) => defaultUpgradeProduct({ serviceId, newProductId: pid, billingCycle: cycle, paymentMethod: method }));
  const orders = deps.getOrders ?? defaultGetOrders;
  return async (req: Request, res: Response) => {
    try {
      const parsed = submitUpgradeSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
      }

      const { configured, enabled, baseUrl } = await resolveAvailability(deps);
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Plan changes aren't available right now." });
      }
      const owned = await resolveOwnedService(deps, req, res, loadServices);
      if (!owned) return;
      const { service } = owned;
      if (service.status.toLowerCase() !== "active") {
        return res.status(409).json({ ok: false, message: "Only active services can be changed." });
      }

      // Validity gate: the target must be another product in the current group
      // and offer the chosen cycle — so a customer can't smuggle an arbitrary pid.
      const catalogue = await loadProducts();
      if (catalogue.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const current = catalogue.products.find((p) => p.pid === service.pid);
      const target = catalogue.products.find((p) => p.pid === parsed.data.newProductId);
      const validTarget =
        !!current &&
        !!target &&
        target.gid === current.gid &&
        target.pid !== current.pid &&
        target.cycles.some((c) => c.cycle === parsed.data.billingCycle);
      if (!validTarget) {
        return res.status(404).json({ ok: false, message: "That plan isn't available for this service." });
      }

      const methods = await loadMethods();
      if (methods.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const gateway = methods.methods[0]?.module;
      if (!gateway) {
        return res.status(409).json({ ok: false, message: "Plan changes aren't available right now because no payment method is set up. Please contact support." });
      }

      const result = await submit(service.id, parsed.data.newProductId, parsed.data.billingCycle, gateway);
      if (!result.ok) {
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : "Couldn't change your plan right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      // UpgradeProduct returns the order id; resolve the invoice id directly when
      // present, otherwise via the order it created.
      let invoiceId = extractInvoiceId(result.data);
      if (!invoiceId) {
        const orderId = extractOrderId(result.data);
        if (orderId) {
          const ordersRes = await orders(orderId);
          if (ordersRes.ok) invoiceId = extractInvoiceIdFromOrders(ordersRes.data);
        }
      }
      const payUrl = invoiceId ? buildInvoicePayUrl(baseUrl, invoiceId) : null;
      return res.json({
        ok: true,
        message: "Your plan change has been submitted.",
        invoiceId,
        payUrl,
      });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't change your plan right now. Please try again shortly." });
    }
  };
}
