import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  addCancelRequest as defaultAddCancelRequest,
  type WhmcsCancellationType,
  type WhmcsRawFetch,
} from "./whmcs";
import { loadServicesList as defaultLoadServicesList, type ServicesListData } from "./whmcs-billing";
import { getParam } from "./http-params";
import { requestServiceCancellationSchema } from "@shared/schema";

// Handler factory for the customer service-cancellation endpoint:
//   POST /api/billing/services/:serviceId/cancel
//
// Extracted from registerRoutes so the security-critical ownership check can be
// unit-tested directly against the production handler (same pattern as
// createUpdateProfileHandler). This is a customer-initiated WHMCS WRITE, so it
// must degrade exactly like the read-only billing features when WHMCS is
// unconfigured/unreachable, the account isn't linked, or the WHMCS API role
// lacks the cancel permission.
//
// Two contracts under test:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user (never
//      request input). The target service id (from the path) must belong to that
//      client AND be active before any WHMCS write happens, so a customer can
//      never cancel a service that isn't theirs by guessing its id.
//   2. Never 500s — every failure degrades to a stable tagged JSON shape.

export interface CancelRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

/** Staff roles barred from the customer-only service-cancellation action. */
function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

export interface CancelRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface CancelRouteDeps {
  getWhmcsSettings: () => Promise<CancelRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<CancelRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real services loader; injectable for tests. */
  loadServicesList?: (clientId: number) => Promise<ServicesListData>;
  /** Defaults to the real writer; injectable for tests. */
  addCancelRequest?: (
    serviceId: number,
    type: WhmcsCancellationType,
    reason?: string,
  ) => Promise<WhmcsRawFetch>;
}

/**
 * Customer self-action: request cancellation of one of the logged-in user's OWN
 * linked WHMCS services. The client id is ALWAYS derived from the session user —
 * never request input. The target service id comes from the path and is
 * confirmed to belong to (and be active on) that client before WHMCS is touched.
 * Validates the body with requestServiceCancellationSchema, returns tagged
 * errors, and never 500s.
 */
export function createRequestCancellationHandler(deps: CancelRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const loadServices = deps.loadServicesList ?? defaultLoadServicesList;
  const submit = deps.addCancelRequest ?? defaultAddCancelRequest;
  return async (req: Request, res: Response) => {
    try {
      const serviceId = Number(getParam(req, "serviceId"));
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return res.status(404).json({ ok: false, message: "That service couldn't be found on your account." });
      }

      const parsed = requestServiceCancellationSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
      }

      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Service cancellation isn't available right now." });
      }

      const user = await deps.getUser(req.session.userId!);
      // Defence-in-depth: staff accounts never have a linked WHMCS client and
      // can only reach this via a UI-gate bypass — reject them before the
      // clientId lookup so WHMCS is never queried for a staff account.
      if (isStaffRole(user?.role)) {
        return res.status(403).json({ ok: false, message: "Staff accounts can't use customer billing actions." });
      }
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ ok: false, message: "Your account isn't linked to billing yet." });
      }

      // Ownership gate: the service must belong to THIS client. We list the
      // client's own services and require the target id to be present — a
      // service id that isn't theirs (or doesn't exist) collapses to a single
      // 404 so there's no enumeration oracle.
      const list = await loadServices(clientId);
      if (list.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const target = list.services.find((s) => s.id === serviceId);
      if (!target) {
        return res.status(404).json({ ok: false, message: "That service couldn't be found on your account." });
      }
      if (target.status.toLowerCase() !== "active") {
        return res.status(409).json({ ok: false, message: "Only active services can be cancelled." });
      }

      const result = await submit(serviceId, parsed.data.type, parsed.data.reason);
      if (!result.ok) {
        // WHMCS validation / permission / duplicate-request errors surface here.
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : "Couldn't submit your cancellation request right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      return res.json({ ok: true, message: "Your cancellation request has been received." });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't submit your cancellation request right now. Please try again shortly." });
    }
  };
}
