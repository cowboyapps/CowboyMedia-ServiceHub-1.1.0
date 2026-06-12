import crypto from "crypto";
import type { Request, Response } from "express";
import type { InsertWhmcsLinkVerification, WhmcsLinkVerification } from "@shared/schema";

// Handler factories for the customer self-service WHMCS account-linking flow:
//   POST /api/whmcs/link/request   (email a 6-digit code to the WHMCS-on-file address)
//   POST /api/whmcs/link/verify    (prove the code back → establish the link)
//
// Extracted from registerRoutes so the security-critical status machine — the
// ownership gate that decides whether a ServiceHub user may attach to a WHMCS
// client — can be unit-tested directly against the PRODUCTION handler (same
// pattern as createCustomerInvoiceDetailHandler in
// server/whmcs-invoice-detail-route.ts). External seams (storage, WHMCS lookup,
// email, activity log, clock) are injected.
//
// Security model (do not weaken):
//   - The WHMCS client id is ALWAYS resolved server-side from the email the user
//     enters; the response never echoes PII or the code, so a user can never
//     discover or attach to an account that isn't theirs.
//   - The verify route NEVER accepts a client-supplied clientId — it reads the
//     id off the stored verification row only.
//   - Code comparison is constant-time (timingSafeEqual over the SHA-256 hashes).
//   - Codes are single-use, expire after WHMCS_LINK_CODE_TTL_MS, and are capped
//     at WHMCS_LINK_MAX_ATTEMPTS wrong tries.

export const WHMCS_LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const WHMCS_LINK_MAX_ATTEMPTS = 5;

export interface WhmcsLinkConfig {
  configured: boolean;
  enabled: boolean;
}

export interface WhmcsLinkRouteUser {
  id: string;
  whmcsClientId?: number | null;
  fullName?: string | null;
}

export interface WhmcsLinkClient {
  id: number;
  email?: string | null;
  fullName?: string | null;
}

export interface WhmcsLinkClientLookup {
  ok: boolean;
  client?: WhmcsLinkClient | null;
}

export interface WhmcsLinkRequestDeps {
  /** Resolves whether WHMCS is wired up + enabled (credentials + base url + flag). */
  getLinkConfig: () => Promise<WhmcsLinkConfig>;
  getUser: (id: string) => Promise<WhmcsLinkRouteUser | null | undefined>;
  getUserByWhmcsClientId: (clientId: number) => Promise<{ id: string } | null | undefined>;
  getClientByEmail: (email: string) => Promise<WhmcsLinkClientLookup>;
  createWhmcsLinkVerification: (data: InsertWhmcsLinkVerification) => Promise<WhmcsLinkVerification>;
  sendTemplatedEmail: (
    to: string,
    templateKey: string,
    vars: Record<string, string>,
    name?: string,
  ) => unknown;
  logActivity: (category: string, action: string, opts: { actorId?: string; summary: string }) => void;
  /** Injectable clock for deterministic expiry in tests. */
  now?: () => number;
}

export interface WhmcsLinkVerifyDeps {
  getUser: (id: string) => Promise<WhmcsLinkRouteUser | null | undefined>;
  getActiveWhmcsLinkVerification: (userId: string) => Promise<WhmcsLinkVerification | null | undefined>;
  getUserByWhmcsClientId: (clientId: number) => Promise<{ id: string } | null | undefined>;
  bumpWhmcsLinkVerificationAttempts: (id: string) => Promise<void>;
  consumeWhmcsLinkVerification: (id: string) => Promise<void>;
  updateUser: (
    id: string,
    data: { whmcsClientId: number; whmcsLinkedAt: Date; whmcsLinkPromptDismissedAt: Date },
  ) => Promise<unknown>;
  logActivity: (category: string, action: string, opts: { actorId?: string; summary: string }) => void;
  /** Injectable clock for deterministic expiry in tests. */
  now?: () => number;
}

function hashCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Request a link code. Resolves the WHMCS client purely from the entered email,
 * refuses if another user already owns that client (no enumeration), and emails
 * the code to the WHMCS-on-file address. Never reveals PII or the code itself.
 */
export function createWhmcsLinkRequestHandler(deps: WhmcsLinkRequestDeps) {
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response) => {
    try {
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      if (!email) return res.status(400).json({ status: "invalid" });

      const user = await deps.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ status: "unavailable" });
      if (user.whmcsClientId) return res.json({ status: "already_linked" });

      const { configured, enabled } = await deps.getLinkConfig();
      if (!configured || !enabled) return res.json({ status: "unavailable" });

      const lookup = await deps.getClientByEmail(email);
      if (!lookup.ok) return res.json({ status: "unavailable" });
      const client = lookup.client;
      if (!client) return res.json({ status: "no_match" });

      // Another ServiceHub user already owns this WHMCS client — refuse and
      // reveal nothing further.
      const existing = await deps.getUserByWhmcsClientId(client.id);
      if (existing && existing.id !== user.id) return res.json({ status: "conflict" });

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
      const codeHash = hashCode(code);
      const expiresAt = new Date(now() + WHMCS_LINK_CODE_TTL_MS);
      await deps.createWhmcsLinkVerification({
        userId: user.id,
        email: client.email || email,
        codeHash,
        whmcsClientId: client.id,
        attempts: 0,
        expiresAt,
      });

      // The code always goes to the WHMCS-on-file address (authoritative); for an
      // exact match this equals what the user typed.
      void deps.sendTemplatedEmail(
        client.email || email,
        "whmcs_link_verification",
        { code, name: client.fullName || user.fullName || "there" },
        client.fullName || user.fullName || undefined,
      );

      deps.logActivity("user", "whmcs_link_code_requested", {
        actorId: user.id,
        summary: "Requested a code to link their billing account",
      });
      res.json({ status: "code_sent" });
    } catch {
      res.json({ status: "unavailable" });
    }
  };
}

/**
 * Verify a link code. Reads the WHMCS client id off the stored verification row
 * ONLY (never request input), constant-time compares the code, re-checks the
 * ownership conflict at link time, and establishes the link. Enforces expiry and
 * the wrong-attempt cap.
 */
export function createWhmcsLinkVerifyHandler(deps: WhmcsLinkVerifyDeps) {
  const now = deps.now ?? Date.now;
  return async (req: Request, res: Response) => {
    try {
      const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
      if (!/^\d{6}$/.test(code)) return res.status(400).json({ status: "invalid_code" });

      const user = await deps.getUser(req.session.userId!);
      if (!user) return res.status(401).json({ status: "expired" });
      if (user.whmcsClientId) return res.json({ status: "already_linked" });

      const v = await deps.getActiveWhmcsLinkVerification(user.id);
      if (!v) return res.json({ status: "expired" });
      if (v.expiresAt.getTime() < now()) {
        await deps.consumeWhmcsLinkVerification(v.id);
        return res.json({ status: "expired" });
      }
      if (v.attempts >= WHMCS_LINK_MAX_ATTEMPTS) {
        await deps.consumeWhmcsLinkVerification(v.id);
        return res.json({ status: "too_many_attempts" });
      }

      const candidate = hashCode(code);
      const a = Buffer.from(candidate, "hex");
      const b = Buffer.from(v.codeHash, "hex");
      const match = a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!match) {
        await deps.bumpWhmcsLinkVerificationAttempts(v.id);
        const attemptsRemaining = Math.max(0, WHMCS_LINK_MAX_ATTEMPTS - (v.attempts + 1));
        return res.json({ status: "invalid_code", attemptsRemaining });
      }

      // Re-check the conflict at the moment of linking — another user may have
      // claimed this WHMCS client between request and verify.
      const existing = await deps.getUserByWhmcsClientId(v.whmcsClientId);
      if (existing && existing.id !== user.id) {
        await deps.consumeWhmcsLinkVerification(v.id);
        return res.json({ status: "conflict" });
      }

      await deps.updateUser(user.id, {
        whmcsClientId: v.whmcsClientId,
        whmcsLinkedAt: new Date(now()),
        whmcsLinkPromptDismissedAt: new Date(now()),
      });
      await deps.consumeWhmcsLinkVerification(v.id);
      deps.logActivity("user", "whmcs_self_linked", {
        actorId: user.id,
        summary: "Linked their billing account via emailed code",
      });
      res.json({ status: "linked" });
    } catch {
      res.json({ status: "expired" });
    }
  };
}
