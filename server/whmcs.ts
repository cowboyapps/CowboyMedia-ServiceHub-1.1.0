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

/**
 * Recover the WHMCS install root from the URL `fetch` finally landed on after
 * following redirects. A very common WHMCS deployment puts the app in a
 * subfolder (example.com/billing) while a vanity subdomain (billing.example.com)
 * 301-redirects to it. Our POST to `<subdomain>/includes/api.php` then follows
 * the redirect into the HTML admin/client area (e.g.
 * `https://example.com/billing/admin/login.php`), which isn't JSON. We strip the
 * WHMCS app subpaths + any trailing `*.php` to recover the root we should have
 * POSTed to (`https://example.com/billing`). Returns null when nothing sensible
 * can be derived. Pure — unit-tested without network.
 */
export function deriveWhmcsRootFromUrl(finalUrl: string | null | undefined): string | null {
  if (!finalUrl) return null;
  try {
    const u = new URL(finalUrl);
    let path = u.pathname;
    // Cut everything from the first WHMCS app subpath onward.
    path = path.replace(
      /\/(admin|clientarea|includes|cart|register|login|announcements|knowledgebase|submitticket|viewticket|dl|index\.php)\b.*$/i,
      "",
    );
    // Drop a trailing file (e.g. login.php) and any trailing slashes.
    path = path.replace(/\/[^/]*\.[a-z0-9]+$/i, "").replace(/\/+$/, "");
    return normalizeBaseUrl(`${u.protocol}//${u.host}${path}`);
  } catch {
    return null;
  }
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

  // One HTTP attempt against a given root. fetch follows redirects by default,
  // so `res.url` is the FINAL landing URL and `res.redirected` flags whether a
  // hop occurred — both used by the self-heal below.
  const attempt = async (root: string) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WHMCS_TIMEOUT_MS);
    try {
      const res = await fetch(`${root}/includes/api.php`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
        signal: controller.signal,
      });
      const text = await res.text().catch(() => "");
      let data: any = null;
      try { data = JSON.parse(text); } catch { /* non-JSON body handled below */ }
      return { res, text, data };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let { res, text, data } = await attempt(baseUrl);

    // Self-heal the vanity-subdomain-redirects-to-subfolder deployment: when the
    // body isn't JSON because fetch followed a redirect into the HTML admin/
    // client area, derive the real WHMCS root from the final URL and retry the
    // API call there once. Makes e.g. base URL "https://billing.example.com"
    // work even though WHMCS actually lives at "https://example.com/billing".
    if (!data && res.redirected) {
      const healedRoot = deriveWhmcsRootFromUrl(res.url);
      if (healedRoot && healedRoot !== baseUrl) {
        const retry = await attempt(healedRoot);
        if (retry.data) {
          ({ res, text, data } = retry);
        }
      }
    }

    if (!res.ok) {
      // WHMCS surfaces auth failures ("Authentication Failed") and IP-allowlist
      // misses ("Invalid IP <ip>") as result:error JSON with a non-2xx status.
      // Prefer that human-readable message over a bare HTTP code so the admin
      // can tell the two apart on the connection test.
      if (data && data.result === "error" && data.message) {
        const msg = String(data.message);
        logError("whmcs", msg, { severity: "warn", summary: `WHMCS ${action} failed`, extra: { action, status: res.status, message: msg } });
        return { ok: false, error: msg, data, reason: "whmcs_error" };
      }
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

// --- Customer profile read/write (Task #371) ---
// The editable WHMCS contact fields a linked customer may view + update from
// inside the app. This is the integration's FIRST customer-initiated WHMCS
// write — everything else is read-only. The field list here is the single
// server-side whitelist: anything not on it is ignored on save (and never read
// back as editable), so a customer can never poke at password/2FA/payment/
// status fields via this surface.

export interface WhmcsClientProfile {
  firstName: string;
  lastName: string;
  companyName: string;
  email: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  postcode: string;
  /** 2-letter ISO country code as stored in WHMCS (e.g. "US", "GB"). */
  country: string;
  phoneNumber: string;
}

/**
 * The editable profile field whitelist: our camelCase key → the WHMCS
 * UpdateClient / GetClientsDetails param name. The ONLY fields a customer can
 * read-as-editable and write. Order is irrelevant; membership is the contract.
 */
export const EDITABLE_PROFILE_FIELDS: ReadonlyArray<readonly [keyof WhmcsClientProfile, string]> = [
  ["firstName", "firstname"],
  ["lastName", "lastname"],
  ["companyName", "companyname"],
  ["email", "email"],
  ["address1", "address1"],
  ["address2", "address2"],
  ["city", "city"],
  ["state", "state"],
  ["postcode", "postcode"],
  ["country", "country"],
  ["phoneNumber", "phonenumber"],
];

/**
 * Map a raw WHMCS GetClientsDetails record to our normalized editable profile
 * shape. WHMCS 7+ returns the record both flattened at the top level and under
 * a `client` object; callers should pass whichever they prefer. Pure → unit
 * tested without network.
 */
export function toClientProfile(raw: any): WhmcsClientProfile {
  const s = (v: any) => String(v ?? "").trim();
  return {
    firstName: s(raw?.firstname),
    lastName: s(raw?.lastname),
    companyName: s(raw?.companyname),
    email: s(raw?.email),
    address1: s(raw?.address1),
    address2: s(raw?.address2),
    city: s(raw?.city),
    state: s(raw?.state),
    postcode: s(raw?.postcode),
    // WHMCS returns the 2-letter code as `country` and the full name as
    // `countryname`; the code is what UpdateClient round-trips.
    country: s(raw?.country),
    phoneNumber: s(raw?.phonenumber),
  };
}

/**
 * Build the WHMCS UpdateClient params from a (already validated) partial
 * profile, applying the editable-field whitelist. Any key NOT in
 * {@link EDITABLE_PROFILE_FIELDS} is dropped, and `undefined` values are
 * skipped so unspecified fields are left untouched in WHMCS. Pure → unit tested
 * without network.
 */
export function buildClientUpdateParams(
  clientId: number,
  input: Partial<WhmcsClientProfile>,
): Record<string, string | number> {
  const params: Record<string, string | number> = { clientid: clientId };
  for (const [key, whmcsKey] of EDITABLE_PROFILE_FIELDS) {
    const v = input[key];
    if (v === undefined) continue;
    params[whmcsKey] = String(v);
  }
  return params;
}

export interface WhmcsClientProfileResult {
  ok: boolean;
  profile?: WhmcsClientProfile | null;
  error?: string;
  reason?: WhmcsFailureReason;
}

/**
 * Load a single client's editable contact profile via GetClientsDetails.
 * Returns profile:null when the client id no longer exists in WHMCS. No-throw
 * tagged result like every other fetcher here.
 */
export async function getClientProfile(clientId: number): Promise<WhmcsClientProfileResult> {
  const r = await whmcsApiCall("GetClientsDetails", { clientid: clientId, stats: false });
  if (!r.ok) {
    if (r.reason === "whmcs_error" && /not found/i.test(r.error ?? "")) {
      return { ok: true, profile: null };
    }
    return { ok: false, error: r.error, reason: r.reason };
  }
  const record = r.data?.client ?? r.data;
  return { ok: true, profile: toClientProfile(record) };
}

/**
 * Persist a partial profile update to WHMCS via UpdateClient. The caller MUST
 * have already resolved `clientId` from the session user (never request input)
 * and validated/whitelisted `input`. No-throw tagged result. WHMCS surfaces a
 * bad email / invalid country etc. as result:error, which is returned with
 * reason "whmcs_error" so the caller can show a friendly message.
 */
export async function updateClient(
  clientId: number,
  input: Partial<WhmcsClientProfile>,
): Promise<WhmcsRawFetch> {
  return whmcsApiCall("UpdateClient", buildClientUpdateParams(clientId, input));
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

/**
 * Raw GetInvoice for a single invoice id. Unlike GetInvoices (the list), this
 * returns the full breakdown: the line items (`items.item`), the
 * subtotal/tax/credit/total/balance figures, payment method, notes, and the
 * owning `userid` used for the ownership check. Caller normalizes `items.item`
 * and shapes the rest in the pure parser.
 */
export async function getInvoice(invoiceId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetInvoice", { invoiceid: invoiceId });
}

/** Raw GetClientsProducts for a client. Caller normalizes `products.product`. */
export async function getClientProducts(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetClientsProducts", { clientid: clientId, stats: true });
}

/** The two cancellation-timing options WHMCS accepts for AddCancelRequest. */
export type WhmcsCancellationType = "Immediate" | "End of Billing Period";

/**
 * Submit a service cancellation request to WHMCS via AddCancelRequest. This is a
 * customer-initiated WHMCS WRITE: the caller MUST have already resolved the
 * owning client from the SESSION user and confirmed the target service id
 * belongs to that client before calling — this stateless wrapper does no
 * ownership check of its own. `type` is the WHMCS cancellation timing
 * ("Immediate" | "End of Billing Period"); `reason` is an optional free-text
 * note (omitted when blank). No-throw tagged result like every other writer
 * here — WHMCS surfaces "no active service" / duplicate-request errors as
 * result:error, returned with reason "whmcs_error" so the caller can show a
 * friendly message.
 */
export async function addCancelRequest(
  serviceId: number,
  type: WhmcsCancellationType,
  reason?: string,
): Promise<WhmcsRawFetch> {
  const params: Record<string, string | number> = { serviceid: serviceId, type };
  const trimmed = (reason ?? "").trim();
  if (trimmed) params.reason = trimmed;
  return whmcsApiCall("AddCancelRequest", params);
}

/**
 * Trigger a product/service module password change in WHMCS via ModuleChangePw.
 * This is a customer-initiated WHMCS WRITE against the LIVE service: the caller
 * MUST have already resolved the owning client from the SESSION user and
 * confirmed the target service id belongs to (and is active on) that client
 * before calling — this stateless wrapper does no ownership check of its own.
 * `newPassword` is generated by the caller and passed as `servicepassword` so
 * WHMCS sets the module + its stored password to a value we can show back to the
 * customer. NEVER log `newPassword`. No-throw tagged result like every other
 * writer here — modules that don't implement a change-password action surface a
 * result:error with reason "whmcs_error", which the caller turns into a friendly
 * "this service doesn't support password resets" message.
 */
export async function changeServicePassword(
  serviceId: number,
  newPassword: string,
): Promise<WhmcsRawFetch> {
  return whmcsApiCall("ModuleChangePw", { serviceid: serviceId, servicepassword: newPassword });
}

/**
 * Raw GetTransactions for a client. Returns every recorded payment / refund
 * transaction for the client (WHMCS keys the client param as `clientid` here).
 * Scoping by clientid is what makes the customer-facing call ownership-safe —
 * a client never sees another client's transactions. Caller normalizes
 * `transactions.transaction` and shapes the rest in the pure parser.
 */
export async function getClientTransactions(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetTransactions", { clientid: clientId });
}

// --- Product catalogue (Task #335) ---

export interface WhmcsProductSummary {
  id: number;
  name: string;
  groupName: string;
}

/**
 * Map a raw WHMCS GetProducts record into the picker summary. WHMCS keys the
 * product/package id as `pid`; `groupname` is present on each product row and
 * helps an admin disambiguate same-named products across groups. Pure → unit
 * tested without network.
 */
export function toProductSummary(raw: any): WhmcsProductSummary {
  const id = Number(raw?.pid ?? raw?.id ?? 0);
  const name = String(raw?.name ?? "").trim();
  return {
    id,
    name: name || (id ? `Product #${id}` : "Product"),
    groupName: String(raw?.groupname ?? "").trim(),
  };
}

export interface WhmcsProductList {
  ok: boolean;
  products?: WhmcsProductSummary[];
  error?: string;
  reason?: WhmcsFailureReason;
}

/**
 * List the full WHMCS product/package catalogue for the admin mapping picker.
 * No-throw tagged result like every other fetcher here. Normalizes the
 * `products.product` wrapper and drops any record without a usable pid.
 */
export async function listProducts(): Promise<WhmcsProductList> {
  const r = await whmcsApiCall("GetProducts", {});
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const products = normalizeListField(r.data?.products, "product")
    .map(toProductSummary)
    .filter((p) => p.id > 0);
  return { ok: true, products };
}

/**
 * Raw GetClientsDetails(stats=true) — provides the client identity/status,
 * currency, and the pre-formatted `stats.creditbalance` display string used
 * for the account balance.
 */
export async function getClientBillingDetails(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetClientsDetails", { clientid: clientId, stats: true });
}

// --- Support ticket read/write fetchers (Task #334) ---
// Thin no-throw wrappers around the WHMCS ticket actions. They return the raw
// tagged result; the pure assembler in whmcs-tickets.ts shapes the response.
// WHMCS tickets are mirrored on read only — ServiceHub never stores them, so
// native ticket behaviour is completely untouched.

/**
 * Raw GetTickets for a client. Caller normalizes `tickets.ticket`. The newest
 * 100 are pulled (WHMCS defaults to oldest-first / 25 rows) so an active client
 * always sees their current threads. `clientid` scopes the result server-side
 * to that one client.
 */
export async function getClientTickets(clientId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetTickets", { clientid: clientId, limitnum: 100 });
}

/**
 * Raw GetTicket for one ticket id. Returns the full thread (`replies.reply`)
 * plus the owning `userid` used for ownership checks. The numeric ticket id
 * (not the human "tid") is required by WHMCS here.
 */
export async function getTicket(ticketId: number): Promise<WhmcsRawFetch> {
  return whmcsApiCall("GetTicket", { ticketid: ticketId });
}

/** One file to forward to WHMCS on a ticket reply (raw bytes, base64-encoded). */
export interface TicketAttachmentUpload {
  /** Original file name shown in WHMCS. */
  name: string;
  /** base64 of the raw file bytes (NOT a data: URL). */
  base64: string;
}

/**
 * Encode files into WHMCS's AddTicketReply `attachments` param. WHMCS expects a
 * base64-encoded JSON array of `{ name, data }`, where `data` is itself the
 * base64 of the raw file bytes. Returns null when there's nothing to attach so
 * the caller simply omits the param. Pure — unit tested without network.
 */
export function encodeTicketAttachments(files: TicketAttachmentUpload[]): string | null {
  const valid = (files ?? []).filter((f) => f && f.name && f.base64);
  if (!valid.length) return null;
  const arr = valid.map((f) => ({ name: f.name, data: f.base64 }));
  return Buffer.from(JSON.stringify(arr)).toString("base64");
}

/**
 * Post a reply to a WHMCS ticket AS the client (clientid attribution). Used for
 * customer-initiated replies — WHMCS records the reply under the client account
 * and moves the ticket to "Customer-Reply", exactly as if posted in the client
 * area. Optional `attachments` are forwarded inline (base64) — nothing is stored
 * in ServiceHub.
 */
export async function addTicketReplyAsClient(
  ticketId: number,
  clientId: number,
  message: string,
  attachments?: TicketAttachmentUpload[],
): Promise<WhmcsRawFetch> {
  const params: Record<string, string | number | boolean> = { ticketid: ticketId, clientid: clientId, message };
  const encoded = encodeTicketAttachments(attachments ?? []);
  if (encoded) params.attachments = encoded;
  return whmcsApiCall("AddTicketReply", params);
}

/**
 * Post a reply to a WHMCS ticket AS staff (adminusername attribution). Used for
 * admin-initiated replies so they show as a support response in WHMCS (and the
 * client gets the staff-reply email). Requires a valid WHMCS admin username,
 * configured in Admin Portal → WHMCS. Optional `attachments` are forwarded
 * inline (base64) — nothing is stored in ServiceHub.
 */
export async function addTicketReplyAsAdmin(
  ticketId: number,
  adminUsername: string,
  message: string,
  attachments?: TicketAttachmentUpload[],
): Promise<WhmcsRawFetch> {
  const params: Record<string, string | number | boolean> = { ticketid: ticketId, adminusername: adminUsername, message };
  const encoded = encodeTicketAttachments(attachments ?? []);
  if (encoded) params.attachments = encoded;
  return whmcsApiCall("AddTicketReply", params);
}

export interface WhmcsAttachmentDownload {
  ok: boolean;
  filename?: string;
  /** base64 of the raw file bytes. */
  data?: string;
  error?: string;
  reason?: WhmcsFailureReason;
}

/**
 * Fetch a single ticket attachment's bytes via WHMCS GetTicketAttachment. WHMCS
 * keys the owner as `relatedid` + `type` ("reply" for a ticket-reply attachment,
 * "ticket" for the opening message) + a 0-based `index`. The data comes back
 * base64-encoded. Used by the download proxy so attachments stay mirror-on-read
 * (never stored in ServiceHub).
 */
export async function getTicketAttachment(
  type: "reply" | "ticket",
  relatedId: number,
  index: number,
): Promise<WhmcsAttachmentDownload> {
  const r = await whmcsApiCall("GetTicketAttachment", { relatedid: relatedId, type, index });
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const filename = String(r.data?.filename ?? r.data?.name ?? "").trim() || "attachment";
  const data = typeof r.data?.data === "string" ? r.data.data : "";
  return { ok: true, filename, data };
}

export interface WhmcsInvoicePdfDownload {
  ok: boolean;
  /** base64 of the raw PDF bytes. */
  data?: string;
  error?: string;
  reason?: WhmcsFailureReason;
}

/**
 * Fetch a single invoice's official PDF bytes via WHMCS GetInvoicePDF. WHMCS
 * returns the rendered PDF base64-encoded under `pdf`. Used by the download
 * proxy so a customer can grab their invoice PDF in-app without a separate
 * WHMCS client-area login — mirror-on-read, nothing is stored in ServiceHub.
 * No-throw tagged result like every other fetcher here; the caller does the
 * ownership check (the invoice must belong to the session user's linked client)
 * BEFORE calling this, exactly like the ticket-attachment proxy.
 */
export async function getInvoicePdf(invoiceId: number): Promise<WhmcsInvoicePdfDownload> {
  const r = await whmcsApiCall("GetInvoicePDF", { invoiceid: invoiceId });
  if (!r.ok) return { ok: false, error: r.error, reason: r.reason };
  const data = typeof r.data?.pdf === "string" ? r.data.pdf : "";
  return { ok: true, data };
}
