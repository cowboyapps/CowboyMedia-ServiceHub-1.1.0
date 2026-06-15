import {
  normalizeListField,
  getClientInvoices,
  getClientProducts,
  getClientBillingDetails,
  getClientTransactions,
  getInvoice,
  getProducts,
  getPaymentMethods,
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

/**
 * Outbound link to the WHMCS rendered invoice page (`viewinvoice.php?id=<id>`),
 * used as the inline-VIEW target (vs `buildInvoicePdfUrl`'s download). WHMCS
 * shows the invoice on screen here — no forced file download — and offers the
 * pay button for unpaid invoices. Requires the client to be authenticated; we
 * link out / SSO into it, we never render it ourselves. The plain (login-walled)
 * fallback when an SSO token can't be minted. Null without a base URL or id.
 */
export function buildInvoiceViewUrl(baseUrl: string | null, id: number): string | null {
  if (!baseUrl || !id) return null;
  return `${baseUrl}/viewinvoice.php?id=${id}`;
}

/**
 * WHMCS-relative path to the rendered invoice page for ONE invoice, used as the
 * `sso_redirect_path` when minting a seamless auto-login VIEW link. Dropping the
 * customer at `viewinvoice.php?id=<id>` via an SSO token opens the invoice on
 * screen (inline) with no login wall — the read counterpart of
 * `buildInvoicePdfPath`'s download. Built server-side from an id the caller has
 * ownership-checked, never from raw request input. Returns null for an invalid id.
 */
export function buildInvoiceViewPath(id: number): string | null {
  if (!Number.isFinite(id) || id <= 0) return null;
  return `/viewinvoice.php?id=${id}`;
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

/**
 * Outbound WHMCS mass-pay deep link for settling several outstanding invoices in
 * one go. WHMCS's `viewinvoice.php` accepts a comma-separated id list and renders
 * a single combined "mass payment" checkout for them — the same authenticated
 * mechanism as the per-invoice pay link. Null without a base URL or any valid id.
 */
export function buildMassPayUrl(baseUrl: string | null, ids: number[]): string | null {
  if (!baseUrl) return null;
  const valid = ids.filter((id) => Number.isFinite(id) && id > 0);
  if (valid.length === 0) return null;
  return `${baseUrl}/viewinvoice.php?id=${valid.join(",")}`;
}

/**
 * WHMCS-relative path to the hosted payment page for one or more invoice ids,
 * used as the `sso_redirect_path` when minting a seamless auto-login pay link.
 * Always built server-side from ids the caller has ownership-checked — never
 * from raw request input. Returns null when no valid id is present.
 */
export function buildInvoicePayPath(ids: number[]): string | null {
  const valid = ids.filter((id) => Number.isFinite(id) && id > 0);
  if (valid.length === 0) return null;
  return `/viewinvoice.php?id=${valid.join(",")}`;
}

/**
 * WHMCS-relative path to the official rendered PDF for ONE invoice, used as the
 * `sso_redirect_path` when minting a seamless auto-login PDF link. WHMCS serves
 * the generated PDF from `dl.php?type=i&id=<id>` to an authenticated client, so
 * dropping the customer there via an SSO token opens the real PDF with no login
 * wall — we never fetch/generate the PDF bytes ourselves. Built server-side from
 * an id the caller has ownership-checked, never from raw request input. Returns
 * null for an invalid id.
 */
export function buildInvoicePdfPath(id: number): string | null {
  if (!Number.isFinite(id) || id <= 0) return null;
  return `/dl.php?type=i&id=${id}`;
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
  /**
   * The single hosting service this invoice renewed, or null. NEVER present on
   * the raw GetInvoices list row (that call carries no line items) — it's filled
   * in afterwards by `applyInvoiceServiceHints`, which correlates the invoice's
   * own line items (fetched via GetInvoice) the same way payments are labelled.
   * Stays null for 0/multiple-service invoices and for invoices we didn't load.
   */
  serviceId: number | null;
  /** The renewed service's display name, or null. Added by the correlation. */
  serviceName: string | null;
  /** Deep link to that service's WHMCS detail page, when available. */
  serviceUrl: string | null;
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
    // The GetInvoices list call carries no line items — the renewed service is
    // correlated later (applyInvoiceServiceHints) from each invoice's detail.
    serviceId: null,
    serviceName: null,
    serviceUrl: null,
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
  /** Raw WHMCS line item type ("Hosting", "Domain", "Invoice", "AddFunds", …). */
  type: string;
  /**
   * The WHMCS service id (tblhosting.id) this line renewed, or null. Only
   * hosting/VPS line items (`type === "Hosting"`) map to a product detail page;
   * for those WHMCS puts the service id in `relid`. Domains and ad-hoc items
   * carry an unrelated relid (a domain id / nothing), so they stay null.
   */
  serviceId: number | null;
  /** Deep link to that service's WHMCS detail page when serviceId + baseUrl exist. */
  serviceUrl: string | null;
}

/**
 * Map a raw WHMCS GetInvoice `items.item` record into a line item. When the
 * line renewed a hosting service (`type === "Hosting"`), `relid` is the service
 * id — capture it (and the outbound product-detail deep link) so the customer
 * can jump from "I paid this" to "what product this was for". Pure.
 */
export function parseInvoiceLineItem(raw: any, baseUrl: string | null = null): ParsedInvoiceLineItem {
  const type = String(raw?.type ?? "").trim();
  const relId = Number(raw?.relid ?? 0);
  const serviceId =
    type.toLowerCase() === "hosting" && Number.isFinite(relId) && relId > 0 ? relId : null;
  return {
    id: Number(raw?.id ?? 0),
    description: String(raw?.description ?? "").trim(),
    amount: String(raw?.amount ?? "").trim(),
    type,
    serviceId,
    serviceUrl: serviceId ? buildServiceUrl(baseUrl, serviceId) : null,
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
    lineItems: normalizeListField(raw?.items, "item").map((item) => parseInvoiceLineItem(item, baseUrl)),
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
  /** Service login username (WHMCS `username`). Sensitive-adjacent. */
  username: string;
  /** Service login password (WHMCS `password`). SENSITIVE — never log. */
  password: string;
}

/**
 * The credential-free product shape carried in the shared billing summary
 * (rendered in BOTH the customer and admin billing views). Service credentials
 * (`username`/`password`) are deliberately stripped from this — they are ONLY
 * ever surfaced through the customer-only `/api/my/services` endpoint, never the
 * admin billing payload or the fleet dashboard.
 */
export type ProductSummary = Omit<ParsedProduct, "username" | "password">;

/**
 * Map a raw WHMCS GetClientsProducts record. Both `id` (the service id,
 * tblhosting.id) and `pid` (the product/package id) are kept — Task #335's
 * product→service mapping keys off `pid`. `username`/`password` come from the
 * same `stats:true` response and back the customer "My Services" credentials
 * view; no other access field (dedicated IP, server hostname, DNS, custom
 * fields, config options) is parsed.
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
    username: String(raw?.username ?? "").trim(),
    password: String(raw?.password ?? ""),
  };
}

// --- Transaction / payment history (Task #400) ---
// A read-only list of the recorded WHMCS payment + refund transactions for a
// client, surfaced to the customer alongside their credit balance so they can
// confirm a payment went through without contacting support.

export interface ParsedTransaction {
  /** WHMCS internal transaction row id — stable React key. */
  id: number;
  /** The invoice this transaction paid, or null when not tied to one (0/absent). */
  invoiceId: number | null;
  /** Transaction date as `YYYY-MM-DD` (time portion dropped), or null. */
  date: string | null;
  description: string;
  gateway: string;
  /** Money received (a payment), as a clean string. null when zero/absent. */
  amountIn: string | null;
  /** Money sent out (a refund), as a clean string. null when zero/absent. */
  amountOut: string | null;
  currencyCode: string | null;
  /**
   * The WHMCS service id this payment renewed, or null. WHMCS only populates a
   * service relation on a transaction when the gateway recorded the renewal
   * against a hosting service (the `relid` field); most transactions (manual
   * payments, add-funds, refunds) have no relid and stay null. In practice WHMCS
   * leaves `relid` empty on almost every transaction, so the service is usually
   * filled in afterwards by correlating the transaction's invoice line items —
   * see `correlateTransactionService` / `applyTransactionServiceHints`.
   */
  serviceId: number | null;
  /**
   * The renewed service's display name, or null. Never present from the raw
   * GetTransactions row — it's added by the invoice-line-item correlation, which
   * looks the name up from the client's product list (falling back to the
   * matching line item's description).
   */
  serviceName: string | null;
  /** Deep link to that service's WHMCS detail page when serviceId + baseUrl exist. */
  serviceUrl: string | null;
}

/** A money string trimmed to null when it is absent OR numerically zero. */
function nonZeroMoney(raw: any): string | null {
  const s = cleanMoney(raw);
  if (s === null) return null;
  return parseMoneyNumber(s) === 0 ? null : s;
}

/**
 * Map a raw WHMCS GetTransactions record into our normalized transaction shape.
 * WHMCS's `currency` field on a transaction is a numeric currency id (useless
 * for display without a lookup) — only honour it when it's actually a 3-letter
 * code, otherwise fall back to the client's currency. When the row carries a
 * service relation (`relid`), capture it + the outbound product-detail deep link
 * so a payment can point at the service it renewed. Pure → unit tested.
 */
export function parseTransaction(
  raw: any,
  currencyDefault: string | null,
  baseUrl: string | null = null,
): ParsedTransaction {
  const rawCurrency = String(raw?.currency ?? "").trim();
  const currencyCode = /^[A-Za-z]{3}$/.test(rawCurrency) ? rawCurrency.toUpperCase() : currencyDefault;
  const invoiceIdRaw = Number(raw?.invoiceid ?? 0);
  const relId = Number(raw?.relid ?? 0);
  const serviceId = Number.isFinite(relId) && relId > 0 ? relId : null;
  return {
    id: Number(raw?.id ?? 0),
    invoiceId: Number.isFinite(invoiceIdRaw) && invoiceIdRaw > 0 ? invoiceIdRaw : null,
    date: normalizeWhmcsDate(raw?.date),
    description: String(raw?.description ?? "").trim(),
    gateway: String(raw?.gateway ?? "").trim(),
    amountIn: nonZeroMoney(raw?.amountin),
    amountOut: nonZeroMoney(raw?.amountout),
    currencyCode,
    serviceId,
    serviceName: null,
    serviceUrl: serviceId ? buildServiceUrl(baseUrl, serviceId) : null,
  };
}

/**
 * The renewed-service hint a single transaction can carry once its invoice line
 * items are known: the service id, its display name, and a deep link.
 */
export interface TransactionServiceHint {
  serviceId: number;
  serviceName: string | null;
  serviceUrl: string | null;
}

/**
 * Correlate a transaction's invoice line items to the single hosting service it
 * renewed. Returns the hint ONLY when exactly one distinct hosting service id
 * appears across the line items — the unambiguous case. Returns null when:
 *  - the invoice wasn't loaded (lineItems undefined),
 *  - it carried no hosting line (0 services — e.g. a domain / add-funds / credit
 *    invoice), or
 *  - it renewed several different services (2+ — ambiguous, so we surface
 *    nothing rather than guessing).
 * The display name prefers the client's product name (keyed by service id),
 * falling back to the matching line item's description. Pure → unit tested.
 */
export function correlateTransactionService(
  lineItems: ParsedInvoiceLineItem[] | undefined | null,
  productNamesById: Map<number, string>,
  baseUrl: string | null = null,
): TransactionServiceHint | null {
  if (!lineItems || lineItems.length === 0) return null;
  const serviceLines = lineItems.filter(
    (li): li is ParsedInvoiceLineItem & { serviceId: number } => li.serviceId != null && li.serviceId > 0,
  );
  const distinctIds = Array.from(new Set(serviceLines.map((li) => li.serviceId)));
  if (distinctIds.length !== 1) return null;
  const serviceId = distinctIds[0];
  const line = serviceLines.find((li) => li.serviceId === serviceId)!;
  const productName = productNamesById.get(serviceId)?.trim();
  const serviceName = productName || line.description.trim() || null;
  const serviceUrl = line.serviceUrl ?? buildServiceUrl(baseUrl, serviceId);
  return { serviceId, serviceName, serviceUrl };
}

/** Index a product list by service id -> display name (skips blanks/0 ids). */
function buildProductNameMap(products: { id: number; name: string }[]): Map<number, string> {
  const productNamesById = new Map<number, string>();
  for (const p of products) {
    if (p.id > 0 && p.name) productNamesById.set(p.id, p.name);
  }
  return productNamesById;
}

/**
 * Enrich a transaction list with the service each payment renewed, using a map
 * of invoiceId -> that invoice's line items and the client's products (for the
 * display name). A transaction is only touched when it has a linked invoice that
 * resolved to exactly one hosting service; every other row passes through
 * unchanged (degrades cleanly for unlinked payments, refunds, multi-service or
 * unloaded invoices). An existing relid-derived serviceId is preserved when no
 * correlation is found. Pure → unit tested.
 */
export function applyTransactionServiceHints(
  transactions: ParsedTransaction[],
  lineItemsByInvoice: Map<number, ParsedInvoiceLineItem[]>,
  products: { id: number; name: string }[],
  baseUrl: string | null = null,
): ParsedTransaction[] {
  const productNamesById = buildProductNameMap(products);
  return transactions.map((t) => {
    if (t.invoiceId == null) return t;
    const hint = correlateTransactionService(lineItemsByInvoice.get(t.invoiceId), productNamesById, baseUrl);
    if (!hint) return t;
    return { ...t, serviceId: hint.serviceId, serviceName: hint.serviceName, serviceUrl: hint.serviceUrl };
  });
}

/**
 * Enrich an invoice LIST with the single hosting service each invoice renewed,
 * using a map of invoiceId -> that invoice's line items and the client's
 * products (for the display name). Reuses the exact same `correlateTransactionService`
 * correlation as the payment-history labelling — an invoice is only labelled when
 * its line items resolve to exactly one distinct hosting service. Every other
 * invoice passes through unchanged: 0-service (domain/credit) invoices,
 * multi-service invoices, and invoices whose detail wasn't loaded all stay null.
 * Pure → unit tested.
 */
export function applyInvoiceServiceHints(
  invoices: ParsedInvoice[],
  lineItemsByInvoice: Map<number, ParsedInvoiceLineItem[]>,
  products: { id: number; name: string }[],
  baseUrl: string | null = null,
): ParsedInvoice[] {
  const productNamesById = buildProductNameMap(products);
  return invoices.map((inv) => {
    const hint = correlateTransactionService(lineItemsByInvoice.get(inv.id), productNamesById, baseUrl);
    if (!hint) return inv;
    return { ...inv, serviceId: hint.serviceId, serviceName: hint.serviceName, serviceUrl: hint.serviceUrl };
  });
}

export interface TransactionHistoryData {
  transactions: ParsedTransaction[];
  /** True when the transactions read failed (its own degradation flag). */
  unreachable: boolean;
}

/**
 * Shape a raw GetTransactions result into the locked history payload, sorted
 * most-recent-first (date desc, with the higher row id breaking ties so
 * same-day transactions stay newest-first). A failed read degrades to an empty
 * list flagged unreachable rather than throwing. Pure → unit tested.
 */
export function buildTransactionHistory(
  transactionsResult: WhmcsRawFetch,
  currencyDefault: string | null,
  baseUrl: string | null = null,
): TransactionHistoryData {
  if (!transactionsResult.ok) {
    return { transactions: [], unreachable: true };
  }
  const transactions = normalizeListField(transactionsResult.data?.transactions, "transaction")
    .map((raw) => parseTransaction(raw, currencyDefault, baseUrl))
    .sort((a, b) => {
      const da = a.date ?? "";
      const db = b.date ?? "";
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      }
      return b.id - a.id;
    });
  return { transactions, unreachable: false };
}

/**
 * Fetch + shape a client's transaction history. The fetcher is scoped to the
 * caller-supplied clientId (always derived from the session user upstream), so
 * a customer can only ever read their own transactions. The fetcher is
 * injectable for tests; it is no-throw, so this never throws into the handler.
 */
export async function loadTransactionHistory(
  clientId: number,
  currencyDefault: string | null,
  baseUrl: string | null = null,
  fetcher: (clientId: number) => Promise<WhmcsRawFetch> = getClientTransactions,
): Promise<TransactionHistoryData> {
  const result = await fetcher(clientId);
  return buildTransactionHistory(result, currencyDefault, baseUrl);
}

/**
 * Cap on how many distinct invoices we'll fetch to enrich the payment history
 * with service names — bounds the extra GetInvoice calls per /api/billing load.
 * Transactions are already most-recent-first, so the newest invoices win.
 */
const TXN_SERVICE_INVOICE_CAP = 20;
/** How many invoice fetches run at once — keep small so we never hammer WHMCS. */
const TXN_SERVICE_CONCURRENCY = 4;

// Short per-client TTL cache for the *enriched* transaction history, mirroring
// the `loadBillingSummary` cache. Without it, every /api/billing view re-fetches
// up to TXN_SERVICE_INVOICE_CAP invoices from WHMCS just to label payment rows.
// Keyed by clientId (per-user UNIQUE upstream, so no cross-user leak); a full
// transactions outage is never cached so a transient failure isn't pinned.
const TXN_HISTORY_CACHE_TTL_MS = 60_000;
interface TxnHistoryCacheEntry {
  at: number;
  data: TransactionHistoryData;
}
const txnHistoryCache = new Map<number, TxnHistoryCacheEntry>();

// Short per-client TTL cache for the combined customer self-view payload (billing
// summary + enriched payment history). The customer route now reads through
// `loadCustomerBillingWithServices` rather than `loadTransactionHistoryWithServices`,
// so this carries the same repeat-view savings HEAD added to the txn loader: keyed
// by clientId, and a transactions outage is never pinned.
interface CustomerBillingCacheEntry {
  at: number;
  data: CustomerBillingData;
}
const customerBillingCache = new Map<number, CustomerBillingCacheEntry>();

/** Reset the enriched billing read caches (test hook). */
export function resetTransactionHistoryCache(): void {
  txnHistoryCache.clear();
  customerBillingCache.clear();
}

/**
 * Fetch each given invoice's line items into a `invoiceId -> lineItems` map,
 * ownership-checked via `loadInvoiceDetail` against `clientId` (so another
 * client's invoice can never leak in). Throttled to a small concurrency and
 * tolerant of per-invoice failures — an invoice that won't load is simply
 * omitted from the map (its caller then leaves the row un-labelled). The id list
 * is fetched as-is, so callers cap/dedup it first. Never throws.
 */
async function fetchLineItemsByInvoice(
  invoiceIds: number[],
  clientId: number,
  baseUrl: string | null,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch>,
): Promise<Map<number, ParsedInvoiceLineItem[]>> {
  const lineItemsByInvoice = new Map<number, ParsedInvoiceLineItem[]>();
  if (invoiceIds.length === 0) return lineItemsByInvoice;
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = cursor++;
      if (i >= invoiceIds.length) return;
      const id = invoiceIds[i];
      try {
        const detail = await loadInvoiceDetail(id, clientId, baseUrl, fetchInvoice);
        if (detail.invoice) lineItemsByInvoice.set(id, detail.invoice.lineItems);
      } catch {
        // Leave this invoice un-labelled — never break the caller's list.
      }
    }
  }
  const workerCount = Math.min(TXN_SERVICE_CONCURRENCY, invoiceIds.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return lineItemsByInvoice;
}

/**
 * Fetch the payment history AND label each row with the single hosting service
 * its invoice renewed. WHMCS transactions almost never carry a `relid`, so the
 * service is correlated through the transaction's invoice line items: for the
 * distinct linked invoices (newest first, capped) we fetch each invoice's detail
 * — ownership-checked via `loadInvoiceDetail` against `clientId` — collect its
 * line items, then `applyTransactionServiceHints` resolves the name from the
 * client's products. Every failure degrades cleanly: a transactions outage flows
 * straight through as `unreachable`; an invoice that won't load just leaves its
 * row un-labelled. Never throws.
 */
export async function loadTransactionHistoryWithServices(
  clientId: number,
  currencyDefault: string | null,
  products: { id: number; name: string }[],
  baseUrl: string | null = null,
  fetchTransactions: (clientId: number) => Promise<WhmcsRawFetch> = getClientTransactions,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch> = getInvoice,
): Promise<TransactionHistoryData> {
  const now = Date.now();
  const cached = txnHistoryCache.get(clientId);
  if (cached && now - cached.at < TXN_HISTORY_CACHE_TTL_MS) return cached.data;

  const history = await loadTransactionHistory(clientId, currencyDefault, baseUrl, fetchTransactions);
  // Never pin a full transactions outage — let it retry on the next view.
  if (history.unreachable) return history;
  // Empty history is a valid (cheap) state; cache it so repeat views skip the
  // GetTransactions call too, but there are no invoices to enrich.
  if (history.transactions.length === 0) {
    txnHistoryCache.set(clientId, { at: now, data: history });
    return history;
  }

  // Distinct linked invoice ids, in the transactions' newest-first order, capped.
  const invoiceIds: number[] = [];
  const seen = new Set<number>();
  for (const t of history.transactions) {
    if (t.invoiceId == null || seen.has(t.invoiceId)) continue;
    seen.add(t.invoiceId);
    invoiceIds.push(t.invoiceId);
    if (invoiceIds.length >= TXN_SERVICE_INVOICE_CAP) break;
  }
  if (invoiceIds.length === 0) {
    txnHistoryCache.set(clientId, { at: now, data: history });
    return history;
  }

  const lineItemsByInvoice = await fetchLineItemsByInvoice(invoiceIds, clientId, baseUrl, fetchInvoice);

  const data: TransactionHistoryData = {
    transactions: applyTransactionServiceHints(history.transactions, lineItemsByInvoice, products, baseUrl),
    unreachable: false,
  };
  txnHistoryCache.set(clientId, { at: now, data });
  return data;
}

/** Drop the credentials so a product is safe to embed in the shared summary. */
export function stripProductCredentials(p: ParsedProduct): ProductSummary {
  const { username: _username, password: _password, ...rest } = p;
  return rest;
}

/**
 * The minimal access view for a customer's ACTIVE service: its name + the
 * billing info already shown today, plus exactly the two access fields
 * (username, password). "Active" is defined the same way as the entitlement
 * filter in `deriveMappedServiceIds` (status === "active", case-insensitive).
 */
export interface ActiveService {
  id: number;
  /** WHMCS product/package id — keys the admin-set per-product DNS (Task #473). */
  pid: number;
  name: string;
  status: string;
  billingCycle: string;
  nextDueDate: string | null;
  amount: string;
  username: string;
  password: string;
  /** Admin-assigned connection address for this product type ("" when unset). */
  dns: string;
}

/**
 * Filter parsed products to ACTIVE ones and project to the access view. Pure →
 * unit tested without network. Suspended/terminated/cancelled/pending/fraud
 * products are excluded so customers only ever see live logins.
 */
export function selectActiveServices(
  products: ParsedProduct[],
  dnsByPid?: Map<number, string>,
): ActiveService[] {
  return products
    .filter((p) => p.status.toLowerCase() === "active")
    .map((p) => ({
      id: p.id,
      pid: p.pid,
      name: p.name,
      status: p.status,
      billingCycle: p.billingCycle,
      nextDueDate: p.nextDueDate,
      amount: p.amount,
      username: p.username,
      password: p.password,
      dns: dnsByPid?.get(p.pid) ?? "",
    }));
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

export interface PayAllOutstanding {
  /** Number of outstanding (unpaid + overdue) invoices being settled together. */
  count: number;
  /** Combined balance owed across them, as a 2-decimal string ("60.00"). */
  total: string;
  /** Currency of the outstanding invoices (first non-null seen), or null. */
  currencyCode: string | null;
  /** WHMCS mass-pay deep link pre-loaded with every outstanding invoice. */
  url: string | null;
}

/**
 * Roll the customer's outstanding (unpaid + overdue) invoices up into a single
 * "pay all" action: the combined balance owed plus a WHMCS mass-pay deep link.
 * Returns null unless there are 2+ outstanding invoices — a single one is already
 * covered by its own pay link. Pure: the total is summed from the already-parsed
 * invoice list (balance, falling back to total) so the figure always matches the
 * list the customer sees.
 */
export function buildPayAllOutstanding(
  invoices: ParsedInvoice[],
  baseUrl: string | null,
): PayAllOutstanding | null {
  const outstanding = invoices.filter((i) => i.status === "unpaid" || i.status === "overdue");
  if (outstanding.length < 2) return null;
  const total = round2(
    outstanding.reduce((sum, i) => sum + parseMoneyNumber(i.balance ?? i.total), 0),
  );
  const currencyCode = outstanding.find((i) => i.currencyCode)?.currencyCode ?? null;
  return {
    count: outstanding.length,
    total: total.toFixed(2),
    currencyCode,
    url: buildMassPayUrl(baseUrl, outstanding.map((i) => i.id)),
  };
}

export interface BillingSummaryData {
  client: { id: number; name: string; status: string } | null;
  balance: { creditBalance: string | null; currencyCode: string | null } | null;
  invoices: ParsedInvoice[];
  products: ProductSummary[];
  portalUrl: string | null;
  /** Combined "pay all outstanding" action, or null when <2 invoices are owed. */
  payAll: PayAllOutstanding | null;
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
    ? normalizeListField(productsResult.data?.products, "product").map(parseProduct).map(stripProductCredentials)
    : [];

  return {
    client,
    balance,
    invoices,
    products,
    portalUrl: buildPortalUrl(baseUrl),
    payAll: buildPayAllOutstanding(invoices, baseUrl),
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

/**
 * Drop a single client's cached billing data so the next /api/billing load
 * re-fetches fresh from WHMCS: the base summary cache, the enriched
 * transaction-history cache, AND the combined customer self-view cache (which is
 * what the customer billing route actually reads). Call this the moment a
 * billing-changing write (e.g. a service cancellation) succeeds for the client,
 * so the customer sees the result immediately instead of waiting out the 60s
 * TTL. Safe to call for a client with nothing cached (a no-op delete).
 */
export function invalidateBillingCaches(clientId: number): void {
  cache.delete(clientId);
  txnHistoryCache.delete(clientId);
  customerBillingCache.delete(clientId);
}

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

/**
 * Pick the invoice ids worth enriching with a renewed-service label: the list as
 * it's already sorted (attention-first), de-duplicated, dropping invalid ids,
 * capped so we never fire an unbounded number of GetInvoice calls. The cap
 * matches the payment-history cap — installs typically have far fewer invoices.
 */
function invoiceIdsToEnrich(invoices: ParsedInvoice[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const inv of invoices) {
    if (inv.id <= 0 || seen.has(inv.id)) continue;
    seen.add(inv.id);
    ids.push(inv.id);
    if (ids.length >= TXN_SERVICE_INVOICE_CAP) break;
  }
  return ids;
}

/**
 * loadBillingSummary, then label each invoice row with the single hosting
 * service it renewed (Task #424). The GetInvoices list call carries no line
 * items, so — exactly like the payment-history labelling — we fetch each
 * invoice's detail (capped, ownership-checked) and reuse the same correlation
 * (`applyInvoiceServiceHints`). Used by the admin customer-billing panel; the
 * customer self-view uses `loadCustomerBillingWithServices` instead so its
 * invoice + payment labelling share one round of fetches. Degrades cleanly: a
 * full outage or empty list returns the base summary untouched, and any invoice
 * that won't load just stays un-labelled. Never throws.
 */
export async function loadBillingSummaryWithInvoiceServices(
  clientId: number,
  baseUrl: string | null,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch> = getInvoice,
  loadSummary: (clientId: number, baseUrl: string | null) => Promise<BillingSummaryData> = loadBillingSummary,
): Promise<BillingSummaryData> {
  const summary = await loadSummary(clientId, baseUrl);
  if (summary.unreachable || summary.invoices.length === 0) return summary;
  const invoiceIds = invoiceIdsToEnrich(summary.invoices);
  if (invoiceIds.length === 0) return summary;
  const lineItemsByInvoice = await fetchLineItemsByInvoice(invoiceIds, clientId, baseUrl, fetchInvoice);
  return {
    ...summary,
    invoices: applyInvoiceServiceHints(summary.invoices, lineItemsByInvoice, summary.products, baseUrl),
  };
}

export interface CustomerBillingData {
  /** Billing summary with each invoice row labelled with its renewed service. */
  summary: BillingSummaryData;
  /** Payment history, each row labelled with its renewed service. */
  transactions: ParsedTransaction[];
  /** True when the transactions read failed (history-only degradation). */
  transactionsUnreachable: boolean;
}

/**
 * The customer self-view billing payload: the billing summary with both its
 * invoice rows AND its payment-history rows labelled with the hosting service
 * each renewed (Tasks #419 + #424). Both features need the SAME invoices' line
 * items, so this fetches the union of {invoice-list ids, linked-transaction ids}
 * exactly ONCE (deduped + capped) and runs both correlations over that one map —
 * an invoice shared by both is never read from WHMCS twice. Every failure
 * degrades independently: a transactions outage only blanks the history
 * (`transactionsUnreachable`), a billing outage only blanks the summary, and any
 * single invoice that won't load just leaves its rows un-labelled. Never throws.
 */
export async function loadCustomerBillingWithServices(
  clientId: number,
  baseUrl: string | null = null,
  fetchTransactions: (clientId: number) => Promise<WhmcsRawFetch> = getClientTransactions,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch> = getInvoice,
  loadSummary: (clientId: number, baseUrl: string | null) => Promise<BillingSummaryData> = loadBillingSummary,
): Promise<CustomerBillingData> {
  const now = Date.now();
  const cached = customerBillingCache.get(clientId);
  if (cached && now - cached.at < TXN_HISTORY_CACHE_TTL_MS) return cached.data;

  const summary = await loadSummary(clientId, baseUrl);
  const currencyDefault = summary.balance?.currencyCode ?? null;
  const history = await loadTransactionHistory(clientId, currencyDefault, baseUrl, fetchTransactions);

  // Union of the invoice-list ids (attention-first, capped) and the linked
  // transaction invoice ids (newest-first, capped), deduped so a paid invoice
  // appearing in both is only fetched once.
  const ids = invoiceIdsToEnrich(summary.invoices);
  const seen = new Set<number>(ids);
  let linkedAdded = 0;
  for (const t of history.transactions) {
    if (t.invoiceId == null || seen.has(t.invoiceId)) continue;
    seen.add(t.invoiceId);
    ids.push(t.invoiceId);
    if (++linkedAdded >= TXN_SERVICE_INVOICE_CAP) break;
  }

  let result: CustomerBillingData;
  if (ids.length === 0) {
    result = { summary, transactions: history.transactions, transactionsUnreachable: history.unreachable };
  } else {
    const lineItemsByInvoice = await fetchLineItemsByInvoice(ids, clientId, baseUrl, fetchInvoice);
    result = {
      summary: {
        ...summary,
        invoices: applyInvoiceServiceHints(summary.invoices, lineItemsByInvoice, summary.products, baseUrl),
      },
      transactions: applyTransactionServiceHints(history.transactions, lineItemsByInvoice, summary.products, baseUrl),
      transactionsUnreachable: history.unreachable,
    };
  }

  // Mirror HEAD's enriched-transaction cache: a short per-client TTL keeps repeat
  // self-views cheap. Never pin a transactions outage so a transient failure isn't
  // held (the summary independently self-refreshes within the same window).
  if (!result.transactionsUnreachable) {
    customerBillingCache.set(clientId, { at: now, data: result });
  }
  return result;
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

// --- Ordering & upgrades (Task #453): pure parsers + loaders ---
// Shape the raw catalogue / payment-method / upgrade-calc results into the locked
// view the customer order + upgrade routes return. All pure (the loaders take an
// injectable fetcher) so they're unit-tested without touching the network.

/**
 * The recurring billing cycles a customer may pick when ordering or upgrading,
 * in ascending term length. The `key` is the value WHMCS expects in
 * `billingcycle`/`newproductbillingcycle`; the `label` is the customer-facing
 * wording. One-time / free products are intentionally out of scope here.
 */
export const ORDER_BILLING_CYCLES = [
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "semiannually", label: "Semi-annually" },
  { key: "annually", label: "Annually" },
  { key: "biennially", label: "Biennially" },
  { key: "triennially", label: "Triennially" },
] as const;

export type OrderBillingCycle = (typeof ORDER_BILLING_CYCLES)[number]["key"];

/**
 * Map a WHMCS billing-cycle LABEL (as returned by GetClientsProducts, e.g.
 * "Monthly", "Semi-Annually") to the lowercase key UpgradeProduct/AddOrder
 * expect. Returns null for one-time/free or anything unrecognised. Pure.
 */
export function cycleKeyFromLabel(label: string | null | undefined): OrderBillingCycle | null {
  const norm = String(label ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (norm) {
    case "monthly": return "monthly";
    case "quarterly": return "quarterly";
    case "semiannually": return "semiannually";
    case "annually": return "annually";
    case "biennially": return "biennially";
    case "triennially": return "triennially";
    default: return null;
  }
}

/** WHMCS keys the per-cycle setup fee with a single-letter prefix on the cycle. */
const SETUP_FEE_KEY: Record<OrderBillingCycle, string> = {
  monthly: "msetupfee",
  quarterly: "qsetupfee",
  semiannually: "ssetupfee",
  annually: "asetupfee",
  biennially: "bsetupfee",
  triennially: "tsetupfee",
};

export interface OrderableProductCycle {
  cycle: OrderBillingCycle;
  label: string;
  /** Recurring price for this cycle, as the raw WHMCS decimal string. */
  price: string;
  /** One-off setup fee for this cycle, or null when there is none. */
  setupFee: string | null;
}

export interface OrderableProduct {
  pid: number;
  gid: number;
  name: string;
  description: string;
  /** The currency code the prices are quoted in (e.g. "USD"), or null. */
  currency: string | null;
  cycles: OrderableProductCycle[];
}

/**
 * WHMCS GetProducts nests pricing under a per-currency block. Prefer the caller's
 * currency code when present, otherwise fall back to the first block so a
 * single-currency install still resolves. Returns the block plus the code it came
 * from. Pure.
 */
function pickPricingBlock(pricing: any, currency?: string | null): { code: string | null; block: any } {
  if (!pricing || typeof pricing !== "object") return { code: null, block: null };
  if (currency && pricing[currency] && typeof pricing[currency] === "object") {
    return { code: currency, block: pricing[currency] };
  }
  const first = Object.keys(pricing)[0];
  return first ? { code: first, block: pricing[first] } : { code: null, block: null };
}

/**
 * Shape one raw WHMCS GetProducts row into an orderable product. Only cycles the
 * product actually offers survive: WHMCS encodes a DISABLED cycle as "-1.00", so
 * any price that parses to a negative number (or isn't a number) is dropped. A
 * setup fee is kept only when it's a positive amount. Pure → unit-tested.
 */
export function parseOrderableProduct(raw: any, currency?: string | null): OrderableProduct {
  const { code, block } = pickPricingBlock(raw?.pricing, currency);
  const cycles: OrderableProductCycle[] = [];
  if (block && typeof block === "object") {
    for (const { key, label } of ORDER_BILLING_CYCLES) {
      const priceRaw = block[key];
      if (priceRaw === undefined || priceRaw === null) continue;
      const price = String(priceRaw).trim();
      const num = parseFloat(price);
      if (!Number.isFinite(num) || num < 0) continue; // "-1.00" => cycle disabled
      const setupRaw = block[SETUP_FEE_KEY[key]];
      const setupStr = setupRaw === undefined || setupRaw === null ? "" : String(setupRaw).trim();
      const setupNum = parseFloat(setupStr);
      const setupFee = setupStr !== "" && Number.isFinite(setupNum) && setupNum > 0 ? setupStr : null;
      cycles.push({ cycle: key, label, price, setupFee });
    }
  }
  return {
    pid: Number(raw?.pid ?? raw?.id ?? 0),
    gid: Number(raw?.gid ?? 0),
    name: String(raw?.name ?? "").trim() || "Product",
    description: String(raw?.description ?? "").trim(),
    currency: code,
    cycles,
  };
}

export interface OrderableProductsData {
  products: OrderableProduct[];
  unreachable: boolean;
}

/**
 * Load the orderable product catalogue. `unreachable` is true when GetProducts
 * failed (outage / missing API permission). Products with no offered cycle (every
 * cycle disabled, or one-time/free only) are dropped so the picker only ever
 * shows something the customer can actually buy. Injectable fetcher for tests.
 */
export async function loadOrderableProducts(
  fetchProducts: () => Promise<WhmcsRawFetch> = getProducts,
  currency?: string | null,
): Promise<OrderableProductsData> {
  const r = await fetchProducts();
  if (!r.ok) return { products: [], unreachable: true };
  const products = normalizeListField(r.data?.products, "product")
    .map((p) => parseOrderableProduct(p, currency))
    .filter((p) => p.pid > 0 && p.cycles.length > 0);
  return { products, unreachable: false };
}

export interface WhmcsPaymentMethod {
  module: string;
  displayName: string;
}

/** Shape one raw WHMCS GetPaymentMethods row. Pure. */
export function parsePaymentMethod(raw: any): WhmcsPaymentMethod {
  const module = String(raw?.module ?? "").trim();
  return { module, displayName: String(raw?.displayname ?? module).trim() };
}

export interface PaymentMethodsData {
  methods: WhmcsPaymentMethod[];
  unreachable: boolean;
}

/**
 * Load the active payment gateways. `unreachable` is true when the read failed.
 * An empty `methods` on a reachable read means WHMCS has no gateway configured —
 * the order route turns that into a friendly "no payment gateway" message rather
 * than letting AddOrder fail opaquely. Injectable fetcher for tests.
 */
export async function loadPaymentMethods(
  fetchMethods: () => Promise<WhmcsRawFetch> = getPaymentMethods,
): Promise<PaymentMethodsData> {
  const r = await fetchMethods();
  if (!r.ok) return { methods: [], unreachable: true };
  const methods = normalizeListField(r.data?.paymentmethods, "paymentmethod")
    .map(parsePaymentMethod)
    .filter((m) => m.module);
  return { methods, unreachable: false };
}

/**
 * The prorated price WHMCS calculates for an upgrade (UpgradeProduct calconly).
 * The field naming has varied across WHMCS versions, so the candidates are read
 * leniently; `price` is null when nothing parseable came back (the route then
 * falls back to showing the new recurring price). Pure.
 */
export function parseUpgradeCalc(data: any): { price: string | null } {
  const candidates = [data?.price, data?.total, data?.totaldue, data?.amount];
  for (const c of candidates) {
    if (c === undefined || c === null) continue;
    const s = String(c).trim();
    if (s !== "" && Number.isFinite(parseFloat(s))) return { price: s };
  }
  return { price: null };
}

/** Extract a positive invoice id from an AddOrder / UpgradeProduct result, or null. */
export function extractInvoiceId(data: any): number | null {
  const id = Number(data?.invoiceid ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Extract a positive order id from an AddOrder / UpgradeProduct result, or null. */
export function extractOrderId(data: any): number | null {
  const id = Number(data?.orderid ?? 0);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Resolve the invoice id WHMCS attached to an order (GetOrders result), or null. */
export function extractInvoiceIdFromOrders(data: any): number | null {
  for (const o of normalizeListField(data?.orders, "order")) {
    const id = Number(o?.invoiceid ?? 0);
    if (Number.isInteger(id) && id > 0) return id;
  }
  return null;
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

export interface InvoiceServiceHintData {
  /** True when WHMCS was unreachable while loading the invoice (outage / perm). */
  unreachable: boolean;
  /** True when the invoice doesn't exist OR doesn't belong to `clientId`. */
  notFound: boolean;
  /** The single hosting service this invoice renewed, or null (0/multi-service). */
  service: TransactionServiceHint | null;
}

/**
 * Resolve the single hosting service ONE invoice renewed, on demand — the lazy
 * twin of the up-front `applyInvoiceServiceHints` enrichment (Task #426). The
 * up-front customer/admin payloads only label the first `TXN_SERVICE_INVOICE_CAP`
 * invoices to bound the WHMCS fan-out; older invoices in a long billing history
 * fall back to this per-row loader, fetched by the frontend only when the row
 * scrolls into view. It loads the invoice's detail (ownership-checked against
 * `clientId`, so a foreign invoice collapses to notFound — no enumeration
 * oracle) and correlates its line items through the SAME
 * `correlateTransactionService` rule used everywhere else; the display name is
 * sharpened from the client's products (via the cached `loadBillingSummary`),
 * degrading to the line-item description when the products read is unavailable.
 * Never throws (the underlying loaders are no-throw).
 */
export async function loadInvoiceServiceHint(
  invoiceId: number,
  clientId: number,
  baseUrl: string | null = null,
  fetchInvoice: (id: number) => Promise<WhmcsRawFetch> = getInvoice,
  loadSummary: (clientId: number, baseUrl: string | null) => Promise<BillingSummaryData> = loadBillingSummary,
): Promise<InvoiceServiceHintData> {
  const detail = await loadInvoiceDetail(invoiceId, clientId, baseUrl, fetchInvoice);
  if (detail.unreachable) return { unreachable: true, notFound: false, service: null };
  if (detail.notFound || !detail.invoice) return { unreachable: false, notFound: true, service: null };
  // Product names sharpen the label but are non-essential — the correlation
  // falls back to the line-item description when products can't be read.
  let products: { id: number; name: string }[] = [];
  try {
    const summary = await loadSummary(clientId, baseUrl);
    products = summary.products;
  } catch {
    products = [];
  }
  const service = correlateTransactionService(detail.invoice.lineItems, buildProductNameMap(products), baseUrl);
  return { unreachable: false, notFound: false, service };
}
