import {
  normalizeListField,
  getClientInvoices,
  getClientProducts,
  getClientBillingDetails,
  type WhmcsRawFetch,
} from "./whmcs";

// Read-only WHMCS billing assembler (Task #333). The pure functions here turn
// raw WHMCS read results into a single locked summary shape shared by the
// customer self route and the admin customer-detail route. They never touch the
// network — `loadBillingSummary` is the thin async orchestrator that fetches +
// caches and delegates the shaping to the pure `buildBillingSummary`.

// --- Pure helpers (unit-tested without network) ---

const ZERO_DATE = /^0000-00-00/;

/**
 * Map a WHMCS date to a clean `YYYY-MM-DD` string, or null. WHMCS returns
 * unset dates as "0000-00-00" (date) / "0000-00-00 00:00:00" (datetime) which
 * would otherwise parse to a bogus year — collapse those to null, and drop any
 * trailing time portion so the value is a plain calendar date.
 */
export function normalizeWhmcsDate(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || ZERO_DATE.test(s)) return null;
  return s.split(" ")[0];
}

export type InvoiceStatus =
  | "paid"
  | "unpaid"
  | "overdue"
  | "cancelled"
  | "refunded"
  | "collections"
  | "draft"
  | "payment_pending"
  | "other";

/**
 * Derive the display status for an invoice. "Overdue" is NOT a stored WHMCS
 * status — it's an Unpaid invoice whose due date is in the past. `today` and
 * `dueDate` are both `YYYY-MM-DD`, so a lexicographic compare is correct.
 */
export function deriveInvoiceStatus(rawStatus: any, dueDate: string | null, today: string): InvoiceStatus {
  const s = String(rawStatus ?? "").trim().toLowerCase();
  switch (s) {
    case "paid":
      return "paid";
    case "cancelled":
      return "cancelled";
    case "refunded":
      return "refunded";
    case "collections":
      return "collections";
    case "draft":
      return "draft";
    case "payment pending":
      return "payment_pending";
    case "unpaid":
      return dueDate && dueDate < today ? "overdue" : "unpaid";
    default:
      return "other";
  }
}

/** Outbound deep link to pay/view a single invoice in WHMCS. */
export function buildInvoicePayUrl(baseUrl: string | null, id: number): string | null {
  if (!baseUrl || !id) return null;
  return `${baseUrl}/viewinvoice.php?id=${id}`;
}

/** Outbound link to the WHMCS client area home. */
export function buildPortalUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/clientarea.php`;
}

export interface ParsedInvoice {
  id: number;
  invoiceNum: string;
  date: string | null;
  dueDate: string | null;
  datePaid: string | null;
  total: string;
  balance: string | null;
  currencyCode: string | null;
  status: InvoiceStatus;
  rawStatus: string;
  payUrl: string | null;
}

/** Map a raw WHMCS GetInvoices record into our normalized invoice shape. */
export function parseInvoice(raw: any, baseUrl: string | null, today: string): ParsedInvoice {
  const id = Number(raw?.id ?? 0);
  const dueDate = normalizeWhmcsDate(raw?.duedate);
  const rawStatus = String(raw?.status ?? "").trim();
  return {
    id,
    invoiceNum: String(raw?.invoicenum ?? "").trim() || String(id),
    date: normalizeWhmcsDate(raw?.date),
    dueDate,
    datePaid: normalizeWhmcsDate(raw?.datepaid),
    total: String(raw?.total ?? "").trim(),
    balance:
      raw?.balance !== undefined && raw?.balance !== null && String(raw.balance).trim() !== ""
        ? String(raw.balance).trim()
        : null,
    currencyCode: raw?.currencycode ? String(raw.currencycode).trim() : null,
    status: deriveInvoiceStatus(rawStatus, dueDate, today),
    rawStatus,
    payUrl: buildInvoicePayUrl(baseUrl, id),
  };
}

export interface ParsedProduct {
  id: number;
  pid: number;
  name: string;
  domain: string;
  status: string;
  nextDueDate: string | null;
  billingCycle: string;
  amount: string;
}

/**
 * Map a raw WHMCS GetClientsProducts record. Both `id` (the service id,
 * tblhosting.id) and `pid` (the product/package id) are kept — Task #335's
 * product→service mapping keys off `pid`.
 */
export function parseProduct(raw: any): ParsedProduct {
  const name = String(raw?.name ?? raw?.translated_name ?? raw?.productname ?? raw?.groupname ?? "").trim();
  return {
    id: Number(raw?.id ?? 0),
    pid: Number(raw?.pid ?? 0),
    name: name || "Service",
    domain: String(raw?.domain ?? "").trim(),
    status: String(raw?.status ?? "").trim(),
    nextDueDate: normalizeWhmcsDate(raw?.nextduedate),
    billingCycle: String(raw?.billingcycle ?? "").trim(),
    amount: String(raw?.recurringamount ?? "").trim(),
  };
}

/**
 * Derive the ServiceHub service ids a customer is entitled to from their WHMCS
 * products and the admin-defined product→service mappings (Task #335). Only
 * ACTIVE products count (a suspended/terminated/cancelled product no longer
 * grants its services). Result is de-duplicated while preserving first-seen
 * order so the UI listing is stable. Pure → unit tested without network.
 */
export function deriveMappedServiceIds(
  products: ParsedProduct[],
  mappings: { whmcsProductId: number; serviceId: string }[],
): string[] {
  const activePids = new Set(
    products
      .filter((p) => p.status.toLowerCase() === "active" && p.pid > 0)
      .map((p) => p.pid),
  );
  const seen = new Set<string>();
  const result: string[] = [];
  for (const m of mappings) {
    if (!activePids.has(m.whmcsProductId)) continue;
    if (seen.has(m.serviceId)) continue;
    seen.add(m.serviceId);
    result.push(m.serviceId);
  }
  return result;
}

export interface BillingSummaryData {
  client: { id: number; name: string; status: string } | null;
  balance: { creditBalance: string | null; currencyCode: string | null } | null;
  invoices: ParsedInvoice[];
  products: ParsedProduct[];
  portalUrl: string | null;
  /** True only when WHMCS was wholly unreachable (every read failed). */
  unreachable: boolean;
}

/**
 * Shape the three raw WHMCS read results into the locked billing summary.
 * Pure: takes the already-fetched results so it's testable without network.
 * A partial failure (e.g. invoices fail but products succeed) degrades that
 * one section to empty rather than failing the whole summary; `unreachable`
 * flips true only when every read failed (full outage).
 */
export function buildBillingSummary(
  baseUrl: string | null,
  billingResult: WhmcsRawFetch,
  invoicesResult: WhmcsRawFetch,
  productsResult: WhmcsRawFetch,
  today: string,
): BillingSummaryData {
  const unreachable = !billingResult.ok && !invoicesResult.ok && !productsResult.ok;

  let client: BillingSummaryData["client"] = null;
  let balance: BillingSummaryData["balance"] = null;
  if (billingResult.ok && billingResult.data) {
    const d = billingResult.data;
    // GetClientsDetails returns the record flattened AND under `client`.
    const rec = d.client ?? d;
    const id = Number(rec?.id ?? rec?.userid ?? rec?.client_id ?? 0);
    const firstName = String(rec?.firstname ?? "").trim();
    const lastName = String(rec?.lastname ?? "").trim();
    const company = String(rec?.companyname ?? "").trim();
    const person = [firstName, lastName].filter(Boolean).join(" ");
    client = {
      id,
      name: company || person || (id ? `Client #${id}` : "Client"),
      status: String(rec?.status ?? "").trim(),
    };

    const currencyCode = rec?.currency_code
      ? String(rec.currency_code).trim()
      : rec?.currencycode
        ? String(rec.currencycode).trim()
        : null;
    const stats = d.stats ?? {};
    // stats.creditbalance is a pre-formatted display string ("$5.00 USD") —
    // pass it through; fall back to the raw `credit` number-string otherwise.
    const creditRaw =
      stats?.creditbalance !== undefined && stats?.creditbalance !== null && String(stats.creditbalance).trim() !== ""
        ? String(stats.creditbalance).trim()
        : rec?.credit !== undefined && rec?.credit !== null
          ? String(rec.credit).trim()
          : null;
    balance = { creditBalance: creditRaw, currencyCode };
  }

  // Pin the rows that need action to the top: overdue, then unpaid, then the
  // rest — each group most-recent-first (date desc, nulls last). Deterministic
  // regardless of WHMCS's incoming order.
  const attentionRank = (status: ParsedInvoice["status"]): number =>
    status === "overdue" ? 0 : status === "unpaid" ? 1 : 2;
  const invoices = invoicesResult.ok
    ? normalizeListField(invoicesResult.data?.invoices, "invoice")
        .map((raw) => parseInvoice(raw, baseUrl, today))
        .sort((a, b) => {
          const r = attentionRank(a.status) - attentionRank(b.status);
          if (r !== 0) return r;
          const da = a.date ?? "";
          const db = b.date ?? "";
          if (da === db) return 0;
          if (!da) return 1;
          if (!db) return -1;
          return db.localeCompare(da);
        })
    : [];

  const products = productsResult.ok
    ? normalizeListField(productsResult.data?.products, "product").map(parseProduct)
    : [];

  return {
    client,
    balance,
    invoices,
    products,
    portalUrl: buildPortalUrl(baseUrl),
    unreachable,
  };
}

// --- Async orchestrator + small in-memory cache (not network-free) ---

const CACHE_TTL_MS = 60_000;
interface CacheEntry {
  at: number;
  data: BillingSummaryData;
}
const cache = new Map<number, CacheEntry>();

/** Current calendar date in UTC as `YYYY-MM-DD` (for overdue derivation). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Fetch + assemble a client's billing summary, with a short per-client TTL
 * cache to cap the 3 outbound WHMCS calls under repeated views. Keyed by
 * clientId, which is per-user UNIQUE, so there is no cross-user leak. Never
 * throws (the underlying fetchers are no-throw) and never caches a full outage,
 * so a transient failure isn't pinned for the TTL window.
 */
export async function loadBillingSummary(clientId: number, baseUrl: string | null): Promise<BillingSummaryData> {
  const now = Date.now();
  const cached = cache.get(clientId);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.data;

  const [billingResult, invoicesResult, productsResult] = await Promise.all([
    getClientBillingDetails(clientId),
    getClientInvoices(clientId),
    getClientProducts(clientId),
  ]);

  const data = buildBillingSummary(baseUrl, billingResult, invoicesResult, productsResult, todayUtc());
  if (!data.unreachable) cache.set(clientId, { at: now, data });
  return data;
}

export interface InvoicesListData {
  invoices: ParsedInvoice[];
  /** True when the single GetInvoices read failed (outage or missing perm). */
  unreachable: boolean;
}

/**
 * Fetch + assemble ONLY a client's invoices — a lighter read than
 * loadBillingSummary (one WHMCS call, not three) for the invoice-due notifier
 * that polls every linked customer on a schedule. Never throws (the fetcher is
 * no-throw). `unreachable` is true when GetInvoices failed — e.g. the API role
 * still lacks the GetInvoices permission — so the notifier skips marker writes
 * and retries next pass. Not cached: the notifier runs on a long interval and
 * must see fresh due/overdue state each pass.
 */
export async function loadInvoicesList(clientId: number, baseUrl: string | null): Promise<InvoicesListData> {
  const result = await getClientInvoices(clientId);
  if (!result.ok) return { invoices: [], unreachable: true };
  const today = todayUtc();
  const invoices = normalizeListField(result.data?.invoices, "invoice").map((raw) => parseInvoice(raw, baseUrl, today));
  return { invoices, unreachable: false };
}
