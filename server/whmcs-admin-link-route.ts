import type { Request, Response } from "express";
import {
  hasWhmcsCredentials as defaultHasWhmcsCredentials,
  getClientById as defaultGetClientById,
  getClientByEmail as defaultGetClientByEmail,
  type WhmcsClientLookup,
} from "./whmcs";
import { getParam } from "./http-params";

// Handler factory for the admin WHMCS account-LINKING writes:
//   POST   /api/admin/users/:id/whmcs/link        (manual link to a client id)
//   DELETE /api/admin/users/:id/whmcs/link        (unlink)
//   POST   /api/admin/users/:id/whmcs/auto-match  (link by exact email)
//
// These are the staff WRITES that mutate a customer's billing RELATIONSHIP
// (which WHMCS client a ServiceHub user is bound to). Extracted from
// registerRoutes — same pattern as the sibling service-lifecycle route — so the
// authorization + idempotency + 409-on-conflict contracts can be unit-tested
// directly against the PRODUCTION handlers (not a copy).
//
// In production all three are mounted behind
//   requirePermission("users.view", "users.manage")
// and are POST/DELETE (write methods), so requirePermission resolves the
// required permission to the MANAGE perm: an unauthenticated caller, a customer,
// or a view-only admin MUST be rejected before any of these handlers run and
// before WHMCS is ever touched.
//
// Contracts under test:
//   1. Idempotency — auto-match on an already-linked user is a no-op
//      (matched:false, alreadyLinked:true), never re-links or errors.
//   2. 409 on conflict — linking/auto-matching to a WHMCS client already bound
//      to a DIFFERENT ServiceHub user is rejected with 409 and no write.
//   3. Audit — every successful link/unlink/auto-match calls logActivity once.

export interface LinkRouteUser {
  id: string;
  username: string;
  email?: string | null;
  whmcsClientId?: number | null;
  whmcsLinkedAt?: Date | null;
}

export interface LinkRouteDeps {
  getUser: (id: string) => Promise<LinkRouteUser | null | undefined>;
  getUserByWhmcsClientId: (clientId: number) => Promise<LinkRouteUser | null | undefined>;
  updateUser: (
    id: string,
    patch: { whmcsClientId: number | null; whmcsLinkedAt: Date | null },
  ) => Promise<LinkRouteUser | null | undefined>;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; targetId?: string; targetType?: string; summary: string },
  ) => void;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real lookups; injectable for tests. */
  getClientById?: (clientId: number) => Promise<WhmcsClientLookup>;
  getClientByEmail?: (email: string) => Promise<WhmcsClientLookup>;
}

/**
 * Manually link a user to a specific WHMCS client id. Verifies the client
 * exists and is not already linked to a different user (409). Audit-logged on
 * success; never 500s into the route (errors degrade to a tagged shape).
 */
export function createWhmcsLinkHandler(deps: LinkRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? defaultHasWhmcsCredentials;
  const getClientById = deps.getClientById ?? defaultGetClientById;

  return async (req: Request, res: Response) => {
    try {
      const userId = getParam(req, "id");
      const user = await deps.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const clientId = Number(req.body?.clientId);
      if (!Number.isInteger(clientId) || clientId <= 0) {
        return res.status(400).json({ message: "A valid WHMCS client id is required" });
      }
      if (!credentials()) {
        return res.status(400).json({ message: "WHMCS is not configured" });
      }
      const lookup = await getClientById(clientId);
      if (!lookup.ok) {
        if (lookup.reason === "not_configured") {
          return res.status(400).json({ message: "WHMCS is not configured" });
        }
        return res.status(502).json({ message: `Could not verify WHMCS client: ${lookup.error}` });
      }
      if (!lookup.client) {
        return res.status(404).json({ message: `WHMCS client #${clientId} was not found` });
      }
      const existing = await deps.getUserByWhmcsClientId(clientId);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ message: `WHMCS client #${clientId} is already linked to ${existing.username}` });
      }
      const updated = await deps.updateUser(userId, { whmcsClientId: clientId, whmcsLinkedAt: new Date() });
      deps.logActivity("user", "whmcs_linked", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Linked ${user.username} to WHMCS client #${clientId} (${lookup.client.email || lookup.client.fullName})`,
      });
      res.json({ ok: true, link: { whmcsClientId: clientId, whmcsLinkedAt: updated?.whmcsLinkedAt ?? null }, linkedClient: lookup.client });
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
    }
  };
}

/** Remove a user's WHMCS link. Audit-logged on success. */
export function createWhmcsUnlinkHandler(deps: LinkRouteDeps) {
  return async (req: Request, res: Response) => {
    try {
      const userId = getParam(req, "id");
      const user = await deps.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      const prev = user.whmcsClientId;
      await deps.updateUser(userId, { whmcsClientId: null, whmcsLinkedAt: null });
      deps.logActivity("user", "whmcs_unlinked", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Unlinked ${user.username} from WHMCS client${prev ? ` #${prev}` : ""}`,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
    }
  };
}

/**
 * Auto-match a user to a WHMCS client by exact email. Idempotent: a no-op
 * (matched:false) when already linked or when there is no unambiguous match;
 * 409 when the matched client belongs to another user. Audit-logged on a real
 * match; never 500s into the route.
 */
export function createWhmcsAutoMatchHandler(deps: LinkRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? defaultHasWhmcsCredentials;
  const getClientById = deps.getClientById ?? defaultGetClientById;
  const getClientByEmail = deps.getClientByEmail ?? defaultGetClientByEmail;

  return async (req: Request, res: Response) => {
    try {
      const userId = getParam(req, "id");
      const user = await deps.getUser(userId);
      if (!user) return res.status(404).json({ message: "User not found" });
      if (!credentials()) {
        return res.status(400).json({ message: "WHMCS is not configured" });
      }
      if (user.whmcsClientId) {
        const r = await getClientById(user.whmcsClientId);
        return res.json({ ok: true, matched: false, alreadyLinked: true, link: { whmcsClientId: user.whmcsClientId, whmcsLinkedAt: user.whmcsLinkedAt }, linkedClient: r.ok ? (r.client ?? null) : null });
      }
      if (!user.email) return res.json({ ok: true, matched: false, reason: "no_email" });
      const lookup = await getClientByEmail(user.email);
      if (!lookup.ok) {
        if (lookup.reason === "not_configured") {
          return res.status(400).json({ message: "WHMCS is not configured" });
        }
        return res.status(502).json({ message: `WHMCS lookup failed: ${lookup.error}` });
      }
      if (!lookup.client) return res.json({ ok: true, matched: false, reason: "no_match" });
      const clientId = lookup.client.id;
      const existing = await deps.getUserByWhmcsClientId(clientId);
      if (existing && existing.id !== userId) {
        return res.status(409).json({ message: `WHMCS client #${clientId} is already linked to ${existing.username}` });
      }
      const updated = await deps.updateUser(userId, { whmcsClientId: clientId, whmcsLinkedAt: new Date() });
      deps.logActivity("user", "whmcs_auto_matched", {
        actorId: req.session.userId,
        targetId: userId,
        targetType: "user",
        summary: `Auto-matched ${user.username} to WHMCS client #${clientId} by email`,
      });
      res.json({ ok: true, matched: true, link: { whmcsClientId: clientId, whmcsLinkedAt: updated?.whmcsLinkedAt ?? null }, linkedClient: lookup.client });
    } catch (e) {
      res.status(500).json({ message: e instanceof Error ? e.message : String(e) });
    }
  };
}
