import { storage } from "./storage";
import { logError } from "./error-log";

// Stateless WHMCS billing-platform API client. Mirrors server/telegram.ts:
// reads the API identifier/secret from env secrets, reads the base URL from
// the whmcs_settings DB row, and NEVER throws into route handlers — every
// public function returns a tagged result object. When WHMCS is unconfigured
// it fails closed (reason: "not_configured") so the rest of the app behaves
// exactly as it did before WHMCS existed.
//
// Credentials live ONLY in env (WHMCS_API_IDENTIFIER / WHMCS_API_SECRET);
// identifier/secret are never logged. The base URL is non-secret config.

const WHMCS_TIMEOUT_MS = 10_000;

export interface WhmcsClientSummary {
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
  companyName: string;
  email: string;
  status: string;
}

type WhmcsFailureReason = "not_configured" | "network" | "whmcs_error";

interface WhmcsApiResult {
  ok: boolean;
  data?: any;
  error?: string;
  reason?: WhmcsFailureReason;
}

/** True when both API credentials are present in the environment. */
export function hasWhmcsCredentials(): boolean {
  return !!process.env.WHMCS_API_IDENTIFIER && !!process.env.WHMCS_API_SECRET;
}

/** Strip a trailing slash and require an http(s) scheme. Returns null when invalid. */
export function normalizeBaseUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

// --- Pure helpers (unit-tested without network) ---

/**
 * Normalize a WHMCS list field into a plain array. WHMCS list responses nest
 * records under a singular key (e.g. `clients.client`, `invoices.invoice`,
 * `products.product`): an array for many results, a single object for exactly
 * one result, and the key omitted entirely for zero results. All three shapes
 * (plus a bare array) collapse to a plain array so callers never branch.
 */
export function normalizeListField(field: any, key: string): any[] {
  if (!field) return [];
  // Tolerate a bare array passed straight in (no wrapper key).
  if (Array.isArray(field)) return field;
  // The real WHMCS wrapper nests records under `key`. An object WITHOUT that
  // key means zero results — never treat it as a phantom record.
  const inner = field[key];
  if (Array.isArray(inner)) return inner;
  if (inner && typeof inner === "object") return [inner];
  return [];
}

/**
 * Normalize the `clients` field of a WHMCS GetClients response into an array.
 * Thin wrapper over {@link normalizeListField} for the `clients.client` shape.
 */
export function normalizeClientsArray(clientsField: any): any[] {
  return normalizeListField(clientsField, "client");
}

/** Map a raw WHMCS client record to our normalized summary shape. */
export function toClientSummary(raw: any): WhmcsClientSummary {
  const firstName = String(raw?.firstname ?? "").trim();
  const lastName = String(raw?.lastname ?? "").trim();
  const companyName = String(raw?.companyname ?? "").trim();
  const id = Number(raw?.id ?? raw?.userid ?? raw?.client_id ?? 0);
  const personName = [firstName, lastName].filter(Boolean).join(" ");
  return {
    id,
    firstName,
    lastName,
    fullName: personName || companyName || (id ? `Client #${id}` : "Unknown client"),
    companyName,
    email: String(raw?.email ?? "").trim(),
    status: String(raw?.status ?? "").trim(),
  };
}

/**
 * Pick the single client whose email EXACTLY equals the target
 * (case-insensitive). WHMCS `search` is a substring match across name /
 * company / email, so exact-equality filtering is mandatory. Returns null
 * when zero or more than one client matches (ambiguous → no auto-link).
 */
export function pickUnambiguousMatchByEmail(clients: any[], email: string): WhmcsClientSummary | null {
  const target = (email ?? "").trim().toLowerCase();
  if (!target) return null;
  const matches = clients
    .map(toClientSummary)
    .filter((c) => c.email.toLowerCase() === target);
  return matches.length === 1 ? matches[0] : null;
}

// --- Network layer ---

async function whmcsApiCall(
  action: string,
  params: Record<string, string | number | boolean> = {},
): Promise<WhmcsApiResult> {
  const identifier = process.env.WHMCS_API_IDENTIFIER;
  const secret = process.env.WHMCS_API_SECRET;
  if (!identifier || !secret) {
    return { ok: false, error: "WHMCS API credentials are not configured", reason: "not_configured" };
  }

  let baseUrl: string | null = null;
  try {
    const settings = await storage.getWhmcsSettings();
    baseUrl = normalizeBaseUrl(settings?.baseUrl);
  } catch (e: any) {
    logError("whmcs", e, { severity: "error", summary: "WHMCS settings read error", extra: { action } });
    return { ok: false, error: e?.message || "Failed to read WHMCS settings", reason: "network" };
  }
  if (!baseUrl) {
    return { ok: false, error: "WHMCS base URL is not configured", reason: "not_configured" };
  }

  const form = new URLSearchParams();
  form.set("identifier", identifier);
  form.set("secret", secret);
  form.set("action", action);
  form.set("responsetype", "json");
  for (const [k, v] of Object.entries(params)) form.set(k, String(v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WHMCS_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/includes/api.php`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    let data: any = null;
    try { data = JSON.parse(text); } catch { /* non-JSON body handled below */ }

    if (!res.ok) {
      const err = `WHMCS API returned HTTP ${res.status}`;
      // NB: never log identifier/secret — only action + status + truncated body.
      logError("whmcs", err, { severity: "warn", summary: err, extra: { action, status: res.status, body: text.slice(0, 500) } });
      return { ok: false, error: err, reason: "network" };
    }

    if (!data) {
      // HTTP 200 but the body isn't JSON — almost always the base URL points at
      // the wrong place (the /admin or client area instead of the WHMCS root),
      // or WHMCS served an HTML error page. Surface that clearly instead of a
      // misleading "HTTP 200" (which reads like success).
      const looksHtml = /^\s*<(?:!doctype|html)/i.test(text);
      const err = looksHtml
        ? "WHMCS returned a web page instead of API data. Set the base URL to your WHMCS root (e.g. https://billing.example.com) — not the /admin or client area — and make sure WHMCS isn't showing an error page."
        : "WHMCS returned an unreadable (non-JSON) response.";
      logError("whmcs", err, { severity: "warn", summary: "WHMCS non-JSON response", extra: { action, status: res.status, body: text.slice(0, 500) } });
      return { ok: false, error: err, reason: "network" };
    }

    if (data.result !== "success") {
      const msg = String(data.message ?? "WHMCS request failed");
      logError("whmcs", msg, { severity: "warn", summary: `WHMCS ${action} failed`, extra: { action, message: msg } });
      return { ok: false, error: msg, data, reason: "whmcs_error" };
    }

    return { ok: true, data };
  } catch (e: any) {
    const aborted = e?.name === "AbortError";
    const msg = aborted ? `WHMCS request timed out after ${WHMCS_TIMEOUT_MS}ms` : (e?.message || "Unknown error");
    logError("whmcs", msg, { severity: "error", summary: aborted ? "WHMCS request timeout" : "WHMCS request error", extra: { action } });
    return { ok: false, error: msg, reason: "network" };
  } finally {
    clearTimeout(timer);
  }
}

// --- Public API ---

export interface WhmcsTestResult {
  ok: boolean;
  error?: string;
  reason?: WhmcsFailureReason;
  totalClients?: number;
}

/**
 * Verify the connection + credentials with a cheap GetClients call.
 * On failure the raw WHMCS message is surfaced so the admin can tell an
 * auth failure ("Authentication Failed") from an IP allowlist miss
 * ("Invalid IP <ip>") — the most common setup mistake.
 */
export async function testConnection(): Promise<WhmcsTestResult> {
  const r = await whmcsApiCall("GetClients", { limitnum: 1 });
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const total = Number(r.data?.totalresults ?? NaN);
  return { ok: true, totalClients: Number.isFinite(total) ? total : undefined };
}

export interface WhmcsClientLookup {
  ok: boolean;
  client?: WhmcsClientSummary | null;
  error?: string;
  reason?: WhmcsFailureReason;
}

/** Find the unambiguous WHMCS client whose email exactly equals `email`. */
export async function getClientByEmail(email: string): Promise<WhmcsClientLookup> {
  const target = (email ?? "").trim();
  if (!target) return { ok: true, client: null };
  const r = await whmcsApiCall("GetClients", { search: target, limitnum: 25 });
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const clients = normalizeClientsArray(r.data?.clients);
  return { ok: true, client: pickUnambiguousMatchByEmail(clients, target) };
}

export interface WhmcsClientSearch {
  ok: boolean;
  clients?: WhmcsClientSummary[];
  error?: string;
  reason?: WhmcsFailureReason;
}

/** Free-text search across WHMCS clients (name / company / email substrings). */
export async function searchClients(query: string, limit = 25): Promise<WhmcsClientSearch> {
  const q = (query ?? "").trim();
  if (!q) return { ok: true, clients: [] };
  const r = await whmcsApiCall("GetClients", { search: q, limitnum: limit });
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const clients = normalizeClientsArray(r.data?.clients).map(toClientSummary);
  return { ok: true, clients };
}

/** Look up a single WHMCS client by id. Returns client:null when not found. */
export async function getClientById(clientId: number): Promise<WhmcsClientLookup> {
  const r = await whmcsApiCall("GetClientsDetails", { clientid: clientId, stats: false });
  if (!r.ok) {
    // GetClientsDetails returns result:error "Client ID Not Found" for a
    // missing id — surface that as not-found rather than a hard error.
    if (r.reason === "whmcs_error" && /not found/i.test(r.error ?? "")) {
      return { ok: true, client: null };
    }
    return { ok: false, error: r.error, reason: r.reason };
  }
  // WHMCS 7+ returns the record both flattened at the top level and under a
  // `client` object; prefer the nested object when present.
  const record = r.data?.client ?? r.data;
  return { ok: true, client: toClientSummary(record) };
}

// --- Billing read fetchers (Task #333) ---
// Thin no-throw wrappers around the relevant WHMCS read actions. They return
// the raw tagged result; the pure assembler in whmcs-billing.ts shapes the
// response. Kept here so all network access stays in this one stateless client.

/** Tagged raw result of a single WHMCS read action. */
export interface WhmcsRawFetch {
  ok: boolean;
  data?: any;
  error?: string;
  reason?: WhmcsFailureReason;
}

/**
 * Raw GetInvoices for a client. WHMCS keys the client param as `userid` here
 * (not `clientid`) and defaults to 25 rows, so an explicit limit is passed.
 * `orderby/order` pull the NEWEST 100 (WHMCS otherwise returns oldest-first, so
 * a client with >100 invoices would miss their current unpaid/overdue ones —
 * exactly the rows this feature is meant to surface). Caller normalizes
 * `invoices.invoice`.
 */
export async function getClientInvoices(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetInvoices", { userid: clientId, limitnum: 100, orderby: "id", order: "desc" });
}

/** Raw GetClientsProducts for a client. Caller normalizes `products.product`. */
export async function getClientProducts(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetClientsProducts", { clientid: clientId, stats: true });
}

/**
 * Raw GetClientsDetails(stats=true) — provides the client identity/status,
 * currency, and the pre-formatted `stats.creditbalance` display string used
 * for the account balance.
 */
export async function getClientBillingDetails(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetClientsDetails", { clientid: clientId, stats: true });
}
