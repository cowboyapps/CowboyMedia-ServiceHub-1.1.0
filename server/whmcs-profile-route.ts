import type { Request, Response } from "express";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  getClientProfile as defaultGetClientProfile,
  updateClient as defaultUpdateClient,
  type WhmcsClientProfile,
  type WhmcsClientProfileResult,
  type WhmcsRawFetch,
} from "./whmcs";
import { updateWhmcsProfileSchema } from "@shared/schema";

// Handler factories for the customer WHMCS-profile endpoints:
//   GET   /api/billing/profile   (load the session user's own editable profile)
//   PATCH /api/billing/profile   (save changes to the session user's own client)
//
// Extracted from registerRoutes so the security-critical client-id derivation
// can be unit-tested directly against the production handlers (same pattern as
// createCustomerInvoiceDetailHandler). The WHMCS client id is ALWAYS resolved
// from the SESSION user — never from request input — and the editable-field
// whitelist lives server-side (updateWhmcsProfileSchema + EDITABLE_PROFILE_FIELDS
// in whmcs.ts). Neither handler 500s for the customer: every failure degrades to
// a stable JSON shape. This is the integration's first customer-initiated WHMCS
// write, so it must degrade exactly like the read-only billing features when
// WHMCS is unconfigured/unreachable, the account isn't linked, or the WHMCS API
// role lacks the client-update permission.

export interface ProfileRouteUser {
  whmcsClientId?: number | null;
}

export interface ProfileRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface ProfileRouteDeps {
  getWhmcsSettings: () => Promise<ProfileRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<ProfileRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real loader; injectable for tests. */
  getClientProfile?: (clientId: number) => Promise<WhmcsClientProfileResult>;
  /** Defaults to the real writer; injectable for tests. */
  updateClient?: (clientId: number, input: Partial<WhmcsClientProfile>) => Promise<WhmcsRawFetch>;
}

/** The locked degraded shape every profile response carries. */
export function emptyProfile(over: Record<string, unknown>) {
  return {
    configured: false,
    enabled: false,
    linked: false,
    unreachable: false,
    profile: null,
    ...over,
  };
}

/**
 * Customer self-view: load the logged-in user's OWN linked WHMCS client's
 * editable contact profile. The client id is ALWAYS derived from the session
 * user — never request input. Never 500s; degrades to a clean disabled /
 * unlinked / unreachable state so the page always renders.
 */
export function createGetProfileHandler(deps: ProfileRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.getClientProfile ?? defaultGetClientProfile;
  return async (req: Request, res: Response) => {
    try {
      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.json(emptyProfile({ configured, enabled }));
      }
      const user = await deps.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.json(emptyProfile({ configured, enabled, linked: false }));
      }
      const result = await load(clientId);
      if (!result.ok || !result.profile) {
        return res.json(emptyProfile({ configured, enabled, linked: true, unreachable: true }));
      }
      return res.json({ configured, enabled, linked: true, unreachable: false, profile: result.profile });
    } catch {
      return res.json(emptyProfile({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  };
}

/**
 * Customer self-save: persist changes to the logged-in user's OWN linked WHMCS
 * client. The client id is ALWAYS derived from the session user — never request
 * input (the body carries only whitelisted contact fields). Validates with
 * updateWhmcsProfileSchema, returns tagged errors, and re-reads the profile on
 * success so the response reflects what WHMCS actually stored. Never 500s.
 */
export function createUpdateProfileHandler(deps: ProfileRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const load = deps.getClientProfile ?? defaultGetClientProfile;
  const save = deps.updateClient ?? defaultUpdateClient;
  return async (req: Request, res: Response) => {
    try {
      const parsed = updateWhmcsProfileSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ ok: false, message: "Please check the highlighted fields.", errors: parsed.error.flatten() });
      }

      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Account editing is unavailable right now." });
      }
      const user = await deps.getUser(req.session.userId!);
      const clientId = user?.whmcsClientId ?? null;
      if (!clientId) {
        return res.status(409).json({ ok: false, message: "Your account isn't linked to billing yet." });
      }

      // Drop empty-string keys for fields the form didn't intend to clear is
      // intentionally NOT done here — an explicit "" clears the field, which is
      // valid for optional contact fields. The schema already trims/validates.
      const result = await save(clientId, parsed.data);
      if (!result.ok) {
        // WHMCS validation / permission errors surface here. Forward a friendly
        // message; the raw WHMCS string can mention "Invalid Permissions" when
        // the API role lacks UpdateClient, or "Invalid email" etc.
        const msg = result.reason === "whmcs_error" && result.error
          ? result.error
          : "Couldn't save your changes right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 400 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      // Re-read so the client renders exactly what WHMCS stored (handles
      // normalization, e.g. country casing). Tolerate a read miss — the write
      // already succeeded.
      const fresh = await load(clientId);
      return res.json({ ok: true, profile: fresh.ok ? (fresh.profile ?? null) : null });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't save your changes right now. Please try again shortly." });
    }
  };
}
