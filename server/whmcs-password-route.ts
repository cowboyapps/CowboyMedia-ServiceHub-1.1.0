import type { Request, Response } from "express";
import { randomInt } from "node:crypto";
import {
  hasWhmcsCredentials,
  normalizeBaseUrl,
  changeServicePassword as defaultChangeServicePassword,
  type WhmcsRawFetch,
} from "./whmcs";
import { loadServicesList as defaultLoadServicesList, type ServicesListData } from "./whmcs-billing";
import { getParam } from "./http-params";
import { isStaffRole } from "./roles";

// Handler factory for the customer service-password-reset endpoint:
//   POST /api/my/services/:serviceId/password
//
// Mirrors createRequestCancellationHandler: extracted from registerRoutes so the
// security-critical ownership check can be unit-tested directly against the
// production handler. This is a customer-initiated WHMCS WRITE against the LIVE
// service, so it must degrade exactly like the read-only billing features when
// WHMCS is unconfigured/unreachable, the account isn't linked, or the module
// doesn't support a password change.
//
// Two contracts under test:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user (never
//      request input). The target service id (from the path) must belong to that
//      client AND be active before any WHMCS write happens, so a customer can
//      never reset the password of a service that isn't theirs by guessing an id.
//   2. Never 500s — every failure degrades to a stable tagged JSON shape. The
//      generated password is returned ONCE in the success body and never logged.

// Character classes for the generated password. Ambiguous glyphs (0/O, 1/l/I)
// are excluded so a customer reading the password off-screen won't transcribe it
// wrong. The symbol set is kept to ones broadly accepted by service modules.
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+";
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

/**
 * Generate a strong random service password using a CSPRNG (crypto.randomInt).
 * Guarantees at least one character from each class, then fills the rest from
 * the combined alphabet and shuffles so the guaranteed characters aren't always
 * in the same positions. Pure-enough to unit test for length + class coverage.
 */
export function generateServicePassword(length = 16): string {
  const len = Math.max(12, length);
  const pick = (set: string) => set[randomInt(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < len) chars.push(pick(ALL));
  // Fisher–Yates shuffle so the guaranteed-class chars are randomly placed.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export interface PasswordRouteUser {
  whmcsClientId?: number | null;
  role?: string | null;
}

export interface PasswordRouteSettings {
  baseUrl?: string | null;
  enabled?: boolean | null;
}

export interface PasswordRouteDeps {
  getWhmcsSettings: () => Promise<PasswordRouteSettings | null | undefined>;
  getUser: (id: string) => Promise<PasswordRouteUser | null | undefined>;
  /** Defaults to the real credential check; injectable for tests. */
  hasWhmcsCredentials?: () => boolean;
  /** Defaults to the real base-url normalizer; injectable for tests. */
  normalizeBaseUrl?: (raw: string | null) => string | null;
  /** Defaults to the real services loader; injectable for tests. */
  loadServicesList?: (clientId: number) => Promise<ServicesListData>;
  /** Defaults to the real writer; injectable for tests. */
  changeServicePassword?: (serviceId: number, newPassword: string) => Promise<WhmcsRawFetch>;
  /** Defaults to the CSPRNG generator; injectable for deterministic tests. */
  generatePassword?: () => string;
}

/**
 * Customer self-action: reset the password of one of the logged-in user's OWN
 * linked WHMCS services. The client id is ALWAYS derived from the session user —
 * never request input. The target service id comes from the path and is
 * confirmed to belong to (and be active on) that client before WHMCS is touched.
 * On success the freshly generated password is returned ONCE in the body so the
 * frontend can show it masked with reveal + copy; it is never logged. Never
 * 500s.
 */
export function createResetServicePasswordHandler(deps: PasswordRouteDeps) {
  const credentials = deps.hasWhmcsCredentials ?? hasWhmcsCredentials;
  const normalize = deps.normalizeBaseUrl ?? normalizeBaseUrl;
  const loadServices = deps.loadServicesList ?? defaultLoadServicesList;
  const submit = deps.changeServicePassword ?? defaultChangeServicePassword;
  const generate = deps.generatePassword ?? (() => generateServicePassword());
  return async (req: Request, res: Response) => {
    try {
      const serviceId = Number(getParam(req, "serviceId"));
      if (!Number.isInteger(serviceId) || serviceId <= 0) {
        return res.status(404).json({ ok: false, message: "That service couldn't be found on your account." });
      }

      const settings = await deps.getWhmcsSettings();
      const baseUrl = normalize(settings?.baseUrl ?? null);
      const configured = credentials() && !!baseUrl;
      const enabled = !!settings?.enabled;
      if (!configured || !enabled) {
        return res.status(409).json({ ok: false, message: "Password resets aren't available right now." });
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
        return res.status(409).json({ ok: false, message: "Only active services can have their password reset." });
      }

      const newPassword = generate();
      const result = await submit(serviceId, newPassword);
      if (!result.ok) {
        // A module that doesn't implement a change-password action (or any other
        // WHMCS validation error) surfaces here. Show WHMCS's message for those
        // so the customer understands; treat everything else as a transient
        // outage.
        const msg = result.reason === "whmcs_error"
          ? "This service doesn't support resetting its password from here. Please contact support."
          : "Couldn't reset your password right now. Please try again shortly.";
        const status = result.reason === "whmcs_error" ? 409 : 502;
        return res.status(status).json({ ok: false, message: msg });
      }

      // The password is returned ONCE here and never persisted or logged.
      return res.json({ ok: true, password: newPassword, message: "Your service password has been reset." });
    } catch {
      return res.status(502).json({ ok: false, message: "Couldn't reset your password right now. Please try again shortly." });
    }
  };
}
