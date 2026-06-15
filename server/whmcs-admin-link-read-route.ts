import type { Request, Response } from "express";
import {
  hasWhmcsCredentials as defaultHasWhmcsCredentials,
  normalizeBaseUrl as defaultNormalizeBaseUrl,
  getClientById as defaultGetClientById,
  getClientByEmail as defaultGetClientByEmail,
  type WhmcsClientLookup,
} from "./whmcs";
import { getParam } from "./http-params";

// Handler factory for the admin WHMCS account-link READ:
//   GET /api/admin/users/:id/whmcs
//
// This is the sibling of the link/unlink/auto-match WRITES
// (server/whmcs-admin-link-route.ts) but it is a PURE READ that powers the
// admin customer-detail billing panel. Extracted from registerRoutes — same
// pattern as the writes — so its "locked shape" + "never writes, never 500s"
// contract can be unit-tested against the PRODUCTION handler (not a copy).
//
// In production it is mounted behind requirePermission("users.view",
// "users.manage"); because it is a GET (read method) the gate resolves the
// required permission to the VIEW perm, so a view-only admin can SEE a
// customer's billing link even though they cannot change it.
//
// Locked response contract (the frontend depends on exactly this shape):
//   { configured, enabled, link, linkedClient, suggestion }
//   - configured: WHMCS credentials present AND a usable base URL is set.
//   - enabled:    the whmcs_settings.enabled toggle.
//   - link:       { whmcsClientId, whmcsLinkedAt } when the user is linked, else null.
//   - linkedClient: the resolved WHMCS client for an existing link, or null when
//                   unconfigured / WHMCS unreachable.
//   - suggestion: an auto-match-by-email candidate for an UNLINKED user, or null
//                 when unconfigured / disabled / no email / WHMCS unreachable.
//
// Safety guarantees under test:
//   1. The response is exactly the five keys above.
//   2. linkedClient/suggestion degrade to null when WHMCS is unreachable — the
//      handler never 500s on a WHMCS lookup failure.
//   3. It NEVER writes (no updateUser, no logActivity) — it is a pure read.

export interface LinkReadRouteUser {
  id: string;
  username: string;
  email?: string | null;
  whmcsClientId?: number | null;
  whmcsLinkedAt?: Date | null;
}

export interface LinkReadSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
  autoMatchByEmail?: boolean | null;
}

export interface LinkReadRouteDeps {
  getUser: (id: string) => Promise<LinkReadRouteUser | null | undefined>;
  getWhmcsSettings: () => Promise<LinkReadSettings | null | undefined>;
  /** Defaults to the real implementations; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  normalizeBaseUrl?: (url: string | null | undefined) => string | null;
  getClientById?: (clientId: number) => Promise<WhmcsClientLookup>;
  getClientByEmail?: (email: string) => Promise<WhmcsClientLookup>;
}

/**
 * PURE read of a user's WHMCS link state. Returns the locked shape
 * { configured, enabled, link, linkedClient, suggestion }. Has NO side-effects
 * (no auto-persist, no audit) and never 500s on WHMCS unreachability —
 * linkedClient/suggestion degrade to null instead. The frontend fires the
 * POST /auto-match mutation when it sees a suggestion.
 */
export function createWhmcsLinkReadHandler(deps: LinkReadRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? defaultHasWhmcsCredentials;
  const normalizeBaseUrl = deps.normalizeBaseUrl ?? defaultNormalizeBaseUrl;
  const getClientById = deps.getClientById ?? defaultGetClientById;
  const getClientByEmail = deps.getClientByEmail ?? defaultGetClientByEmail;

  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });
      const settings = await deps.getWhmcsSettings();
      const configured = credentials() && !!normalizeBaseUrl(settings?.baseUrl);
      const enabled = !!settings?.enabled;
      const autoMatch = settings?.autoMatchByEmail ?? true;

      const link = user.whmcsClientId
        ? { whmcsClientId: user.whmcsClientId, whmcsLinkedAt: user.whmcsLinkedAt }
        : null;

      let linkedClient = null;
      if (configured && link) {
        const r = await getClientById(link.whmcsClientId);
        linkedClient = r.ok ? (r.client ?? null) : null;
      }

      let suggestion = null;
      if (configured && enabled && autoMatch && !link && user.email) {
        const r = await getClientByEmail(user.email);
        suggestion = r.ok ? (r.client ?? null) : null;
      }

      res.json({ configured, enabled, link, linkedClient, suggestion });
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
    }
  };
}
