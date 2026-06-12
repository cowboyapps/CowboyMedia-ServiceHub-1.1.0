import {
  normalizeListField,
  getClientInvoices,
  getClientProducts,
  getClientBillingDetails,
  getInvoice,
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

/**
 * Outbound link to the official WHMCS invoice PDF. WHMCS serves the generated
 * PDF from `dl.php?type=i&id=<id>` (requires the client to be authenticated in
 * the WHMCS client area — we link out, we never fetch/generate the PDF here).
 */
export function buildInvoicePdfUrl(baseUrl: string | null, id: number): string | null {
  if (!baseUrl || !id) return null;
  return `${baseUrl}/dl.php?type=i&id=${id}`;
}

/** Outbound link to the WHMCS client area home. */
export function buildPortalUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/clientarea.php`;
}

/** Outbound link to a specific WHMCS service's detail page. */
export function buildServiceUrl(baseUrl: string | null, serviceId: number): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/clientarea.php?action=productdetails&id=${serviceId}`;
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

/** Trim a money/number string field to a clean value, or null when absent. */
function cleanMoney(raw: any): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

export interface ParsedInvoiceLineItem {
  id: number;
  description: string;
  amount: string;
}

/** Map a raw WHMCS GetInvoice `items.item` record into a line item. */
export function parseInvoiceLineItem(raw: any): ParsedInvoiceLineItem {
  return {
    id: Number(raw?.id ?? 0),
    description: String(raw?.description ?? "").trim(),
    amount: String(raw?.amount ?? "").trim(),
  };
}

export interface ParsedInvoiceDetail {
  id: number;
  invoiceNum: string;
  /** Owning WHMCS client id — used for the route-level ownership check. */
  userId: number;
  date: string | null;
  dueDate: string | null;
  datePaid: string | null;
  subtotal: string | null;
  credit: string | null;
  tax: string | null;
  tax2: string | null;
  taxRate: string | null;
  taxRate2: string | null;
  total: string;
  balance: string | null;
  currencyCode: string | null;
  status: InvoiceStatus;
  rawStatus: string;
  paymentMethod: string | null;
  notes: string | null;
  lineItems: ParsedInvoiceLineItem[];
  payUrl: string | null;
  pdfUrl: string | null;
}

/**
 * Map a raw WHMCS GetInvoice (single) record into our normalized detail shape.
 * GetInvoice returns more than the list call: the line items plus the full
 * totals breakdown (subtotal/tax/tax2/credit/total/balance) and the owning
 * `userid`. Pure → unit tested without network.
 */
export function parseInvoiceDetail(raw: any, baseUrl: string | null, today: string): ParsedInvoiceDetail {
  const id = Number(raw?.invoiceid ?? raw?.id ?? 0);
  const dueDate = normalizeWhmcsDate(raw?.duedate);
  const rawStatus = String(raw?.status ?? "").trim();
  const paymentMethod =
    String(raw?.paymentmethodname ?? "").trim() || String(raw?.paymentmethod ?? "").trim() || null;
  return {
    id,
    invoiceNum: String(raw?.invoicenum ?? "").trim() || String(id),
    userId: Number(raw?.userid ?? raw?.clientid ?? 0),
    date: normalizeWhmcsDate(raw?.date),
    dueDate,
    datePaid: normalizeWhmcsDate(raw?.datepaid),
    subtotal: cleanMoney(raw?.subtotal),
    credit: cleanMoney(raw?.credit),
    tax: cleanMoney(raw?.tax),
    tax2: cleanMoney(raw?.tax2),
    taxRate: cleanMoney(raw?.taxrate),
    taxRate2: cleanMoney(raw?.taxrate2),
    total: String(raw?.total ?? "").trim(),
    balance: cleanMoney(raw?.balance),
    currencyCode: raw?.currencycode ? String(raw.currencycode).trim() : null,
    status: deriveInvoiceStatus(rawStatus, dueDate, today),
    rawStatus,
    paymentMethod,
    notes: cleanMoney(raw?.notes),
    lineItems: normalizeListField(raw?.items, "item").map(parseInvoiceLineItem),
    payUrl: buildInvoicePayUrl(baseUrl, id),
    pdfUrl: buildInvoicePdfUrl(baseUrl, id),
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

// --- Admin billing dashboard rollup (Task #370) ---
// A fleet-wide view across every linked customer: outstanding/overdue totals,
// active vs suspended service counts, and estimated recurring revenue. The pure
// `buildBillingDashboard` rolls up already-fetched per-customer summaries so it's
// unit-tested without network; `loadBillingDashboard` is the throttled async
// orchestrator that fetches each customer (reusing the cached loadBillingSummary)
// and tolerates per-customer failures.

/** Round a money figure to 2 decimals, avoiding float drift on the .005 edge. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Parse a numeric amount out of a WHMCS money string. Strips currency symbols,
 * codes, and thousands separators, leaving a plain number. Returns 0 for any
 * absent/unparseable value so a single bad field never NaNs a running total.
 */
export function parseMoneyNumber(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return 0;
  const cleaned = String(raw).trim().replace(/[^0-9.,-]/g, "").replace(/,/g, "");
  if (!cleaned) return 0;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Normalize a recurring product amount to a per-month figure for MRR. Only the
 * known recurring WHMCS billing cycles contribute; one-time / free / unknown
 * cycles return 0 so MRR is never inflated by non-recurring charges. Pure.
 */
export function monthlyizeAmount(amount: string | null | undefined, billingCycle: string | null | undefined): number {
  const n = parseMoneyNumber(amount);
  if (n <= 0) return 0;
  switch (String(billingCycle ?? "").trim().toLowerCase()) {
    case "monthly":
      return n;
    case "quarterly":
      return n / 3;
    case "semi-annually":
    case "semiannually":
    case "semi annually":
      return n / 6;
    case "annually":
    case "yearly":
      return n / 12;
    case "biennially":
      return n / 24;
    case "triennially":
      return n / 36;
    default:
      return 0;
  }
}

export interface BillingDashboardCustomerRow {
  /** ServiceHub user id — used for drill-through to the customer's billing. */
  userId: string;
  /** WHMCS client id. */
  clientId: number;
  name: string;
  /** WHMCS client status (Active / Inactive / Closed). */
  status: string;
  /** Sum of balances on this customer's unpaid + overdue invoices. */
  outstanding: number;
  /** Sum of balances on this customer's overdue invoices only. */
  overdue: number;
  /** Count of unpaid + overdue invoices (overdue is a subset). */
  unpaidCount: number;
  /** Count of overdue invoices. */
  overdueCount: number;
  currencyCode: string | null;
}

export interface BillingDashboardSummary {
  linkedCustomers: number;
  customersLoaded: number;
  customersFailed: number;
  totalOutstanding: number;
  overdueAmount: number;
  overdueInvoiceCount: number;
  /** Unpaid + overdue invoice count across the fleet. */
  unpaidInvoiceCount: number;
  activeServices: number;
  suspendedServices: number;
  estimatedMrr: number;
  /** First currency seen — installs are usually single-currency. */
  currencyCode: string | null;
}

export interface BillingDashboardData {
  summary: BillingDashboardSummary;
  /** Customers with a positive outstanding balance, highest first. */
  customers: BillingDashboardCustomerRow[];
  /** True when at least one linked customer's read failed (skipped + counted). */
  partial: boolean;
  /** True when there were customers but every one failed (full outage). */
  unreachable: boolean;
  generatedAt: string;
}

export interface DashboardCustomerEntry {
  userId: string;
  /** ServiceHub display name, used when WHMCS doesn't return a client name. */
  fallbackName: string;
  /** null/unreachable summary => the customer is counted as failed. */
  summary: BillingSummaryData | null;
}

/**
 * Roll up per-customer billing summaries into the fleet-wide dashboard. Pure —
 * the caller fetches the summaries, this just aggregates. A customer whose
 * summary is null or `unreachable` is skipped and counted in `customersFailed`,
 * flipping `partial`; the rest still aggregate so one bad customer never sinks
 * the whole dashboard.
 */
export function buildBillingDashboard(entries: DashboardCustomerEntry[], generatedAt: string): BillingDashboardData {
  let totalOutstanding = 0;
  let overdueAmount = 0;
  let overdueInvoiceCount = 0;
  let unpaidInvoiceCount = 0;
  let activeServices = 0;
  let suspendedServices = 0;
  let estimatedMrr = 0;
  let customersLoaded = 0;
  let customersFailed = 0;
  let currencyCode: string | null = null;
  const customers: BillingDashboardCustomerRow[] = [];

  for (const entry of entries) {
    const s = entry.summary;
    if (!s || s.unreachable) {
      customersFailed++;
      continue;
    }
    customersLoaded++;

    let custOutstanding = 0;
    let custOverdue = 0;
    let custUnpaid = 0;
    let custOverdueCount = 0;
    let custCurrency: string | null = null;

    for (const inv of s.invoices) {
      if (inv.status !== "unpaid" && inv.status !== "overdue") continue;
      const bal = parseMoneyNumber(inv.balance ?? inv.total);
      custOutstanding += bal;
      custUnpaid++;
      if (inv.status === "overdue") {
        custOverdue += bal;
        custOverdueCount++;
      }
      if (!custCurrency && inv.currencyCode) custCurrency = inv.currencyCode;
    }

    for (const p of s.products) {
      const st = p.status.toLowerCase();
      if (st === "active") {
        activeServices++;
        estimatedMrr += monthlyizeAmount(p.amount, p.billingCycle);
      } else if (st === "suspended") {
        suspendedServices++;
      }
    }

    if (!currencyCode) currencyCode = custCurrency || s.balance?.currencyCode || null;
    totalOutstanding += custOutstanding;
    overdueAmount += custOverdue;
    overdueInvoiceCount += custOverdueCount;
    unpaidInvoiceCount += custUnpaid;

    if (custOutstanding > 0.0001) {
      customers.push({
        userId: entry.userId,
        clientId: s.client?.id ?? 0,
        name: s.client?.name || entry.fallbackName,
        status: s.client?.status ?? "",
        outstanding: round2(custOutstanding),
        overdue: round2(custOverdue),
        unpaidCount: custUnpaid,
        overdueCount: custOverdueCount,
        currencyCode: custCurrency,
      });
    }
  }

  customers.sort((a, b) => b.outstanding - a.outstanding);

  return {
    summary: {
      linkedCustomers: entries.length,
      customersLoaded,
      customersFailed,
      totalOutstanding: round2(totalOutstanding),
      overdueAmount: round2(overdueAmount),
      overdueInvoiceCount,
      unpaidInvoiceCount,
      activeServices,
      suspendedServices,
      estimatedMrr: round2(estimatedMrr),
      currencyCode,
    },
    customers,
    partial: customersFailed > 0,
    unreachable: entries.length > 0 && customersLoaded === 0,
    generatedAt,
  };
}

const DASHBOARD_CACHE_TTL_MS = 60_000;
const DASHBOARD_CONCURRENCY = 4;
let dashboardCache: { at: number; signature: string; data: BillingDashboardData } | null = null;

/** Reset the dashboard cache (test hook). */
export function resetBillingDashboardCache(): void {
  dashboardCache = null;
}

export interface DashboardLinkedCustomer {
  userId: string;
  fallbackName: string;
  clientId: number;
}

/**
 * Fetch + roll up the billing dashboard across every linked customer. Fans out
 * one cached loadBillingSummary per customer (the N+1), but throttled to a small
 * concurrency so we never hammer WHMCS, and each call is no-throw so one bad
 * customer is skipped + counted rather than failing the batch. A short whole-
 * dashboard TTL cache keeps repeat loads cheap; the cache is keyed by the set of
 * linked client ids so it busts when the linked set changes, and a full outage
 * is never pinned.
 */
export async function loadBillingDashboard(
  linked: DashboardLinkedCustomer[],
  baseUrl: string | null,
): Promise<BillingDashboardData> {
  const signature = linked.map((l) => l.clientId).sort((a, b) => a - b).join(",");
  const now = Date.now();
  if (dashboardCache && dashboardCache.signature === signature && now - dashboardCache.at < DASHBOARD_CACHE_TTL_MS) {
    return dashboardCache.data;
  }

  const entries: DashboardCustomerEntry[] = new Array(linked.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= linked.length) return;
      const l = linked[i];
      let summary: BillingSummaryData | null = null;
      try {
        summary = await loadBillingSummary(l.clientId, baseUrl);
      } catch {
        summary = null;
      }
      entries[i] = { userId: l.userId, fallbackName: l.fallbackName, summary };
    }
  }
  const workerCount = Math.min(DASHBOARD_CONCURRENCY, Math.max(1, linked.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const data = buildBillingDashboard(entries, todayUtc());
  if (!data.unreachable) dashboardCache = { at: now, signature, data };
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

export interface ServicesListData {
  services: ParsedProduct[];
  unreachable: boolean;
}

/**
 * List a client's WHMCS services/products for the service-lifecycle notifier.
 * Mirrors loadInvoicesList: never throws (the fetcher is no-throw); `unreachable`
 * is true when GetClientsProducts failed — e.g. the API role still lacks the
 * product-read permission — so the notifier skips marker writes and retries next
 * pass. Not cached: the notifier runs on a long interval and must see fresh
 * status/next-due state each pass.
 */
export async function loadServicesList(clientId: number): Promise<ServicesListData> {
  const result = await getClientProducts(clientId);
  if (!result.ok) return { services: [], unreachable: true };
  const services = normalizeListField(result.data?.products, "product").map(parseProduct);
  return { services, unreachable: false };
}

export interface InvoiceDetailData {
  invoice: ParsedInvoiceDetail | null;
  /** True when WHMCS was unreachable (outage / missing perm). */
  unreachable: boolean;
  /**
   * True when the invoice doesn't exist OR doesn't belong to `clientId`. The two
   * are intentionally collapsed so the route never reveals whether another
   * client's invoice id exists (no enumeration oracle).
   */
  notFound: boolean;
}

/**
 * Fetch + shape a SINGLE invoice's detail, scoped to one client. The caller
 * passes the client id it derived itself (session user's linked client, or the
 * admin-selected user's linked client) — this loader rejects any invoice whose
 * owning `userid` doesn't match, so a customer can never read another client's
 * invoice by guessing its id. Never throws (the fetcher is no-throw). Not cached
 * — a single read is cheap and the detail view is opened on demand.
 */
export async function loadInvoiceDetail(
  invoiceId: number,
  clientId: number,
  baseUrl: string | null,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch> = getInvoice,
): Promise<InvoiceDetailData> {
  const result = await fetchInvoice(invoiceId);
  if (!result.ok) {
    // A WHMCS "not found" is a clean not-found; anything else is an outage.
    if (result.reason === "whmcs_error" && /not\s*found|does not exist|invalid/i.test(result.error ?? "")) {
      return { invoice: null, unreachable: false, notFound: true };
    }
    return { invoice: null, unreachable: true, notFound: false };
  }
  const invoice = parseInvoiceDetail(result.data, baseUrl, todayUtc());
  // Ownership check: the invoice must belong to the resolved client.
  if (!invoice.id || invoice.userId !== clientId) {
    return { invoice: null, unreachable: false, notFound: true };
  }
  return { invoice, unreachable: false, notFound: false };
}
