import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  moduleSuspend as defaultModuleSuspend,
  moduleUnsuspend as defaultModuleUnsuspend,
  moduleTerminate as defaultModuleTerminate,
  type WhmcsRawFetch,
} from "./whmcs";
import { loadServicesList as defaultLoadServicesList, type ServicesListData } from "./whmcs-billing";
import { getParam } from "./http-params";
import { ADMIN_SERVICE_ACTIONS, adminSuspendServiceSchema, type AdminServiceAction } from "@shared/schema";

// Handler factory for the admin service-lifecycle endpoint:
//   POST /api/admin/users/:id/whmcs/services/:serviceId/:action
//   (action ∈ suspend | unsuspend | terminate)
//
// Staff-only WHMCS WRITES against a customer's LIVE service. Extracted from
// registerRoutes so the ownership + audit contract can be unit-tested directly
// against the production handler (same pattern as the customer cancel route).
//
// Contracts under test:
//   1. Ownership — the WHMCS client id is resolved from the SELECTED customer
//      (the :id path param), and the target service id (from the path) must
//      belong to that client before any WHMCS write happens. A service id that
//      isn't theirs (or doesn't exist) collapses to a single 404 with no
//      enumeration oracle.
//   2. Audit — every successful action calls the injected logActivity so the
//      who/which-service/which-action/when lands in the activity log.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape and
//      no-ops cleanly when WHMCS is unconfigured/disabled/unlinked/unreachable.

export interface AdminServiceActionUser {
  whmcsClientId?: number | null;
}

export interface AdminServiceActionSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface AdminServiceActionDeps {
  getWhmcsSettings: () => Promise<AdminServiceActionSettings | null | undefined>;
  getUser: (id: string) => Promise<AdminServiceActionUser | null | undefined>;
  /** Audit-log writer. Called once on every successful action. */
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; targetId?: string; targetType?: string; summary: string },
  ) => void;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real services loader; injectable for tests. */
  loadServicesList?: (clientId: number) => Promise<ServicesListData>;
  /** Defaults to the real writers; injectable for tests. */
  moduleSuspend?: (serviceId: number, reason?: string) => Promise<WhmcsRawFetch>;
  moduleUnsuspend?: (serviceId: number) => Promise<WhmcsRawFetch>;
  moduleTerminate?: (serviceId: number) => Promise<WhmcsRawFetch>;
}

function isAdminServiceAction(v: string): v is AdminServiceAction {
  return (ADMIN_SERVICE_ACTIONS as readonly string[]).includes(v);
}

// Per-action wording so success toasts + the audit log read naturally.
const ACTION_COPY: Record<AdminServiceAction, { verb: string; done: string; auditAction: string }> = {
  suspend: { verb: "suspend", done: "suspended", auditAction: "whmcs_service_suspended" },
  unsuspend: { verb: "unsuspend", done: "unsuspended", auditAction: "whmcs_service_unsuspended" },
  terminate: { verb: "terminate", done: "terminated", auditAction: "whmcs_service_terminated" },
};

/**
 * Admin staff action: suspend / unsuspend / terminate one of a SELECTED
 * customer's WHMCS services. The owning client id is resolved from the selected
 * user (path :id) — never request input — and the target service id is confirmed
 * to belong to that client before WHMCS is touched. Status guards keep the
 * actions sensible (only an active service can be suspended; only a suspended
 * one unsuspended). Audit-logged on success; returns tagged errors; never 500s.
 */
export function createAdminServiceActionHandler(deps: AdminServiceActionDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const loadServices = deps.loadServicesList ?? defaultLoadServicesList;
  const suspend = deps.moduleSuspend ?? defaultModuleSuspend;
  const unsuspend = deps.moduleUnsuspend ?? defaultModuleUnsuspend;
  const terminate = deps.moduleTerminate ?? defaultModuleTerminate;

  return async (req: Request, res: Response) => {
    try {
      const action = getParam(req, "action");
      if (!isAdminServiceAction(action)) {
        return res.status(404).json({ ok: false, message: "Unknown action." });
      }
      const copy = ACTION_COPY[action];

      const serviceId = Number(getParam(req, "serviceId"));
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return res.status(404).json({ ok: false, message: "That service couldn't be found for this customer." });
      }

      // Suspend may carry an optional reason; the other actions ignore the body.
      let reason: string | undefined;
      if (action === "suspend") {
        const parsed = adminSuspendServiceSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
        }
        reason = parsed.data.reason;
      }

      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Billing actions aren't available right now." });
      }

      const targetUserId = getParam(req, "id");
      const user = await deps.getUser(targetUserId);
      if (!user) {
        return res.status(404).json({ ok: false, message: "Customer not found." });
      }
      const clientId = user.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ ok: false, message: "This customer isn't linked to billing yet." });
      }

      // Ownership gate: the service must belong to THIS customer's client.
      const list = await loadServices(clientId);
      if (list.unreachable) {
        return res.status(502).json({ ok: false, message: "We couldn't reach the billing system right now. Please try again shortly." });
      }
      const target = list.services.find((s) => s.id === serviceId);
      if (!target) {
        return res.status(404).json({ ok: false, message: "That service couldn't be found for this customer." });
      }

      // Status guards keep each action sensible and idempotent-ish. Terminate is
      // allowed from any non-terminated state (the confirm dialog gates the
      // destructive part); already-terminated collapses to a clear 409.
      const status = target.status.toLowerCase();
      if (action === "suspend" && status !== "active") {
        return res.status(409).json({ ok: false, message: "Only an active service can be suspended." });
      }
      if (action === "unsuspend" && status !== "suspended") {
        return res.status(409).json({ ok: false, message: "Only a suspended service can be unsuspended." });
      }
      if (action === "terminate" && status === "terminated") {
        return res.status(409).json({ ok: false, message: "This service is already terminated." });
      }

      const result =
        action === "suspend"
          ? await suspend(serviceId, reason)
          : action === "unsuspend"
            ? await unsuspend(serviceId)
            : await terminate(serviceId);

      if (!result.ok) {
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : `Couldn't ${copy.verb} this service right now. Please try again shortly.`;
        const httpStatus = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(httpStatus).json({ ok: false, message: msg });
      }

      deps.logActivity("admin", copy.auditAction, {
        actorId: req.session.userId,
        targetId: targetUserId,
        targetType: "user",
        summary: `${copy.done[0].toUpperCase()}${copy.done.slice(1)} billing service #${serviceId} (${target.name}) for customer ${clientId}`,
      });

      return res.json({ ok: true, action, message: `Service ${copy.done}.` });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't complete that action right now. Please try again shortly." });
    }
  };
}
