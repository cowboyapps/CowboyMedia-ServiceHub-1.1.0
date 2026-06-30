import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { queryClient, apiRequest, liveQueryOptions } from "@/lib/queryClient";
import { serverActionErrorMessage, isTimeoutError, paymentTimeoutMessage } from "@/lib/server-error";
export { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { useIdempotencyKey } from "@/hooks/use-idempotency-key";
import {
  Wallet,
  Receipt,
  Package,
  ExternalLink,
  CreditCard,
  AlertCircle,
  Link2Off,
  ServerCog,
  FileText,
  Download,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  XCircle,
  AlertTriangle,
  History,
  Search,
  CheckCircle2,
  Info,
  X,
  PauseCircle,
  PlayCircle,
  Trash2,
} from "lucide-react";

// Shared, read-only presentation of a WHMCS billing summary. Driven entirely by
// the locked payload from GET /api/billing (customer) and
// GET /api/admin/users/:id/whmcs/billing (admin) so both call sites render an
// identical view. Never assumes WHMCS is reachable — every absent/empty/error
// state has a clean rendering.

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

export interface BillingInvoice {
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
  // The single hosting service this invoice renewed (Task #424), correlated
  // server-side from the invoice's line items. All null for 0/multiple-service
  // invoices and for invoices whose detail wasn't loaded.
  serviceId?: number | null;
  serviceName?: string | null;
  serviceUrl?: string | null;
}

export interface BillingProduct {
  id: number;
  pid: number;
  name: string;
  domain: string;
  status: string;
  nextDueDate: string | null;
  billingCycle: string;
  amount: string;
}

export interface PayAllOutstanding {
  count: number;
  total: string;
  currencyCode: string | null;
  url: string | null;
}

export interface BillingTransaction {
  id: number;
  /** The invoice this payment settled, or null when not tied to one. */
  invoiceId: number | null;
  date: string | null;
  description: string;
  gateway: string;
  amountIn: string | null;
  amountOut: string | null;
  currencyCode: string | null;
  /** The WHMCS service this payment renewed, or null when not tied to one. */
  serviceId?: number | null;
  /** The renewed service's display name, or null when not tied to one. */
  serviceName?: string | null;
  /** Deep link to that service's WHMCS detail page, when available. */
  serviceUrl?: string | null;
}

export interface BillingSummary {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  client: { id: number; name: string; status: string } | null;
  balance: { creditBalance: string | null; currencyCode: string | null } | null;
  invoices: BillingInvoice[];
  products: BillingProduct[];
  /** Payment / refund history — only populated in the customer payload. */
  transactions?: BillingTransaction[];
  /** True when the transactions read failed (history-only degradation). */
  transactionsUnreachable?: boolean;
  portalUrl: string | null;
  payAll: PayAllOutstanding | null;
}

export interface InvoiceLineItem {
  id: number;
  description: string;
  amount: string;
  /** WHMCS line item type ("Hosting", "Domain", …). */
  type?: string;
  /** The WHMCS service id this line renewed, or null when not a service line. */
  serviceId?: number | null;
  /** Deep link to that service's WHMCS detail page, when available. */
  serviceUrl?: string | null;
}

export interface InvoiceDetail {
  id: number;
  invoiceNum: string;
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
  lineItems: InvoiceLineItem[];
  payUrl: string | null;
  pdfUrl: string | null;
}

export interface InvoiceDetailPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  notFound: boolean;
  invoice: InvoiceDetail | null;
}

/** The renewed-service hint a single invoice carries, when one can be resolved. */
export interface InvoiceServiceHint {
  serviceId: number;
  serviceName: string | null;
  serviceUrl: string | null;
}

/** Lazy per-invoice renewed-service lookup payload (GET .../invoices/:id/service). */
export interface InvoiceServicePayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  notFound: boolean;
  service: InvoiceServiceHint | null;
}

const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  overdue: "Overdue",
  cancelled: "Cancelled",
  refunded: "Refunded",
  collections: "Collections",
  draft: "Draft",
  payment_pending: "Payment Pending",
  other: "—",
};

function invoiceBadgeClass(status: InvoiceStatus): string {
  switch (status) {
    case "paid":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "unpaid":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "overdue":
    case "collections":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "payment_pending":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function productBadgeClass(status: string): string {
  switch (status.toLowerCase()) {
    case "active":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "pending":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "suspended":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "terminated":
    case "cancelled":
    case "fraud":
      return "bg-destructive/15 text-destructive border-destructive/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatMoney(amount: string | null, currencyCode: string | null): string {
  const a = (amount ?? "").trim();
  if (!a) return "—";
  // Pre-formatted display strings (e.g. "$5.00 USD") already carry a symbol or
  // code — pass through. Bare numbers get the currency code appended.
  if (currencyCode && /^-?[\d.,]+$/.test(a)) return `${a} ${currencyCode}`;
  return a;
}

/** Best-effort numeric value out of a display money string ("$1,234.56 USD" -> 1234.56). */
function parseAmount(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.\-]/g, "");
  if (!cleaned) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isNaN(n) ? null : n;
}

/** How the customer has chosen to order their invoice list. */
export type InvoiceSortMode = "newest" | "outstanding";

/** localStorage key persisting the customer's invoice sort choice across visits. */
const INVOICE_SORT_STORAGE_KEY = "billing:invoice-sort";

/**
 * Rank used by "Outstanding first": bills that need action float to the top —
 * overdue (0), then unpaid (1), then everything else (2). Mirrors the
 * attention-first ordering the server used before invoices went strictly
 * newest-first (Task #520).
 */
function attentionRank(status: InvoiceStatus): number {
  return status === "overdue" ? 0 : status === "unpaid" ? 1 : 2;
}

/**
 * Order invoices for display, client-side, over the already-loaded list.
 * - "newest": the server's default strict date-desc order — returned untouched.
 * - "outstanding": overdue → unpaid → rest, each group kept newest-first.
 * Returns a new array; never mutates the input. Date tie-breaks fall back to a
 * descending id compare so the order is deterministic.
 */
export function sortInvoices(
  invoices: BillingInvoice[],
  mode: InvoiceSortMode,
): BillingInvoice[] {
  if (mode === "newest") return invoices;
  return [...invoices].sort((a, b) => {
    const r = attentionRank(a.status) - attentionRank(b.status);
    if (r !== 0) return r;
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) return db.localeCompare(da);
    return b.id - a.id;
  });
}

/**
 * Snapshot of "what the customer still owes" used to detect a settled payment
 * after returning from WHMCS's off-site checkout. Captures the set of invoices
 * that are still outstanding plus the aggregate outstanding total, so a pre/post
 * refresh comparison can tell whether anything actually got paid (avoids false
 * "Payment received" confirmations when nothing changed).
 */
interface OutstandingSnapshot {
  outstandingInvoiceIds: number[];
  outstandingTotal: number | null;
}

export function summarizeOutstanding(d: BillingSummary | undefined): OutstandingSnapshot {
  if (!d) return { outstandingInvoiceIds: [], outstandingTotal: null };
  const outstandingInvoiceIds = d.invoices
    .filter((inv) => inv.status === "unpaid" || inv.status === "overdue")
    .map((inv) => inv.id);
  return { outstandingInvoiceIds, outstandingTotal: parseAmount(d.payAll?.total ?? null) };
}

/**
 * "Amount due at this time": everything the customer still owes right now,
 * summed from their unpaid + overdue invoices (each invoice's remaining balance,
 * falling back to its total). Derived from the invoice list — NOT `payAll`, which
 * is null unless 2+ invoices are owed — so it's correct even for a single
 * outstanding invoice and always matches the invoices the customer sees below.
 * Currency is taken from the first outstanding invoice, falling back to the
 * account-balance currency.
 */
export function amountDueAtThisTime(d: BillingSummary): {
  total: string;
  currencyCode: string | null;
  count: number;
} {
  const outstanding = d.invoices.filter(
    (inv) => inv.status === "unpaid" || inv.status === "overdue",
  );
  const total = outstanding.reduce(
    (sum, inv) => sum + (parseAmount(inv.balance ?? inv.total) ?? 0),
    0,
  );
  const currencyCode =
    outstanding.find((inv) => inv.currencyCode)?.currencyCode ??
    d.balance?.currencyCode ??
    null;
  return { total: total.toFixed(2), currencyCode, count: outstanding.length };
}

/**
 * Richer outcome of comparing the outstanding state before and after a forced
 * billing refresh. `settled` is the headline (did any money land); the extra
 * fields let the UI tailor the confirmation copy for the three flows the task
 * cares about: a single invoice paid, a partial payment (some still owed), and
 * a pay-all that cleared everything.
 */
export interface PaymentSettlement {
  /** True when a payment actually landed (an invoice flipped to Paid, or the
   *  aggregate outstanding total dropped). */
  settled: boolean;
  /** How many previously-outstanding invoices are now marked Paid. */
  paidInvoiceCount: number;
  /** True when a payment landed AND nothing is left outstanding afterward. */
  fullyCleared: boolean;
}

/**
 * Classify what happened to the customer's outstanding balance across a forced
 * billing refresh. A payment counts when a previously-outstanding invoice is now
 * Paid, OR the aggregate outstanding total dropped (covers partial payments and
 * pay-all). Cancellation / refund of an invoice (outstanding -> cancelled) does
 * NOT count as a payment.
 */
export function classifyPaymentSettlement(
  before: OutstandingSnapshot,
  after: BillingSummary | undefined,
): PaymentSettlement {
  if (!after) return { settled: false, paidInvoiceCount: 0, fullyCleared: false };
  const afterById = new Map(after.invoices.map((inv) => [inv.id, inv]));
  let paidInvoiceCount = 0;
  for (const id of before.outstandingInvoiceIds) {
    if (afterById.get(id)?.status === "paid") paidInvoiceCount++;
  }
  const afterTotal = parseAmount(after.payAll?.total ?? null);
  const totalDropped =
    before.outstandingTotal != null &&
    afterTotal != null &&
    afterTotal < before.outstandingTotal;
  const settled = paidInvoiceCount > 0 || totalDropped;
  const stillOutstanding = after.invoices.some(
    (inv) => inv.status === "unpaid" || inv.status === "overdue",
  );
  return { settled, paidInvoiceCount, fullyCleared: settled && !stillOutstanding };
}

/**
 * Given the outstanding state before and after a forced billing refresh, decide
 * whether a payment actually landed. True when an invoice that was outstanding is
 * now Paid, or when the aggregate outstanding total dropped. Cancellation /
 * refund of an invoice (outstanding -> cancelled) does NOT count as a payment.
 */
export function detectPaymentSettled(
  before: OutstandingSnapshot,
  after: BillingSummary | undefined,
): boolean {
  return classifyPaymentSettlement(before, after).settled;
}

/**
 * Decide whether to reassure the customer that NOTHING was charged after they
 * returned from WHMCS's hosted checkout without paying (cancelled / closed the
 * tab). Only true when:
 *  - no payment settled across the refresh window (so we never contradict the
 *    green "Payment received" banner), AND
 *  - there was actually something outstanding to pay BEFORE they left (avoids a
 *    false note for a customer with a zero balance who somehow followed a link),
 *    AND
 *  - something is still outstanding afterward (the invoice really is still open;
 *    an outstanding -> cancelled/refunded flow leaves nothing open, so we stay
 *    silent there too).
 * This is gated in the effect by `payClickedRef` so it can only fire after the
 * customer actually followed a pay link.
 */
export function shouldShowNoPaymentNotice(
  before: OutstandingSnapshot,
  after: BillingSummary | undefined,
): boolean {
  if (!after) return false;
  if (classifyPaymentSettlement(before, after).settled) return false;
  const hadOutstanding =
    before.outstandingInvoiceIds.length > 0 ||
    (before.outstandingTotal != null && before.outstandingTotal > 0);
  if (!hadOutstanding) return false;
  return after.invoices.some(
    (inv) => inv.status === "unpaid" || inv.status === "overdue",
  );
}

/** A simple full-width informational state (not configured / not linked / etc). */
function EmptyState({
  icon: Icon,
  title,
  description,
  testid,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
  testid: string;
}) {
  return (
    <div className="text-center py-10" data-testid={testid}>
      <Icon className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
    </div>
  );
}

/** A label/value row in the totals breakdown. */
function TotalsRow({
  label,
  value,
  strong,
  testid,
}: {
  label: string;
  value: string;
  strong?: boolean;
  testid: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={strong ? "font-semibold" : "text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-semibold" : ""} data-testid={testid}>
        {value}
      </span>
    </div>
  );
}

/**
 * Open WHMCS's hosted payment page for the customer. First asks `endpoint` to
 * mint a single-use auto-login (SSO) URL so they land on the payment page ALREADY
 * signed in (no WHMCS login wall); on ANY failure it falls back to the plain
 * `directUrl` (the existing viewinvoice deep link) so payment is never a dead end.
 *
 * The new tab is opened SYNCHRONOUSLY on the click so it survives popup blockers,
 * then redirected once the URL is known. The minted URL is a one-time credential
 * and is never persisted or logged client-side.
 */
async function openWhmcsPay(endpoint: string, directUrl: string): Promise<void> {
  const win = window.open("about:blank", "_blank");
  if (win) {
    try {
      win.opener = null;
    } catch {
      // ignore — some browsers disallow reassigning opener
    }
  }
  let target = directUrl;
  try {
    const res = await apiRequest("POST", endpoint);
    const body = await res.json().catch(() => null);
    if (body?.url) target = body.url as string;
  } catch {
    // SSO unavailable / not linked / unreachable — fall back to the direct link.
  }
  if (win) {
    win.location.href = target;
  } else {
    window.open(target, "_blank", "noopener,noreferrer");
  }
}

/**
 * Full-detail view of a single invoice, fetched on demand. Reused by both the
 * customer billing screen and the admin customer-billing panel — the only
 * difference is which endpoint it reads (derived from `context` + `userId`).
 * Every non-success payload state has a clean rendering; it never crashes.
 */
function InvoiceDetailDialog({
  invoiceId,
  context,
  userId,
  onClose,
  onPayClick,
  enableSso,
}: {
  invoiceId: number | null;
  context: "customer" | "admin";
  userId?: string;
  onClose: () => void;
  onPayClick?: () => void;
  enableSso?: boolean;
}) {
  const isAdmin = context === "admin";
  const queryKey =
    isAdmin && userId
      ? ["/api/admin/users", userId, "whmcs", "billing", "invoices", String(invoiceId)]
      : ["/api/billing/invoices", String(invoiceId)];

  const { data, isLoading } = useQuery<InvoiceDetailPayload>({
    queryKey,
    enabled: invoiceId != null,
    ...liveQueryOptions,
  });

  const invoice = data?.invoice ?? null;
  const needsPay = invoice && (invoice.status === "unpaid" || invoice.status === "overdue");

  // Our invoice endpoint, which SSO-redirects the customer straight into WHMCS so
  // they never get bounced to a client-area login. It serves two affordances by
  // query: bare URL ("View PDF") opens the invoice inline at viewinvoice.php;
  // `?download=1` ("Download PDF") saves the file from dl.php. Ownership is
  // enforced against the linked client, so we only build the URL with an invoice.
  const pdfProxyUrl =
    invoice
      ? isAdmin && userId
        ? `/api/admin/users/${userId}/whmcs/billing/invoices/${invoice.id}/pdf`
        : `/api/billing/invoices/${invoice.id}/pdf`
      : null;

  return (
    <Dialog open={invoiceId != null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto" data-testid="dialog-invoice-detail">
        <DialogHeader>
          <DialogTitle data-testid="text-invoice-detail-num">
            Invoice {invoice ? `#${invoice.invoiceNum}` : ""}
          </DialogTitle>
          <DialogDescription>
            {isAdmin ? "Full breakdown of this customer's invoice." : "Full breakdown of your invoice."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3" data-testid="invoice-detail-loading">
            <Skeleton className="h-6 rounded" />
            <Skeleton className="h-24 rounded" />
            <Skeleton className="h-20 rounded" />
          </div>
        ) : !data || data.unreachable ? (
          <EmptyState
            icon={ServerCog}
            title="Invoice unavailable"
            description="We couldn't load this invoice right now. Please try again in a few minutes."
            testid="invoice-detail-unreachable"
          />
        ) : data.notFound || !invoice ? (
          <EmptyState
            icon={AlertCircle}
            title="Invoice not found"
            description="This invoice couldn't be found. It may have been removed."
            testid="invoice-detail-not-found"
          />
        ) : (
          <div className="space-y-4" data-testid="invoice-detail-content">
            {/* Status + key dates */}
            <div className="flex items-center justify-between gap-3">
              <Badge variant="outline" className={invoiceBadgeClass(invoice.status)} data-testid="badge-invoice-detail-status">
                {INVOICE_STATUS_LABEL[invoice.status]}
              </Badge>
              <span className="text-lg font-semibold" data-testid="text-invoice-detail-total">
                {formatMoney(invoice.total, invoice.currencyCode)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <span className="text-muted-foreground">Issued</span>
              <span className="text-right" data-testid="text-invoice-detail-date">{formatDate(invoice.date)}</span>
              <span className="text-muted-foreground">Due</span>
              <span className="text-right" data-testid="text-invoice-detail-due">{formatDate(invoice.dueDate)}</span>
              {invoice.datePaid && (
                <>
                  <span className="text-muted-foreground">Paid</span>
                  <span className="text-right" data-testid="text-invoice-detail-paid">{formatDate(invoice.datePaid)}</span>
                </>
              )}
              {invoice.paymentMethod && (
                <>
                  <span className="text-muted-foreground">Payment method</span>
                  <span className="text-right" data-testid="text-invoice-detail-method">{invoice.paymentMethod}</span>
                </>
              )}
            </div>

            {/* Line items */}
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Line items</p>
              {invoice.lineItems.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2" data-testid="text-invoice-detail-no-items">
                  No line items on this invoice.
                </p>
              ) : (
                <div className="rounded-md border divide-y">
                  {invoice.lineItems.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 p-2.5" data-testid={`row-invoice-item-${item.id}`}>
                      <div className="min-w-0">
                        <span className="text-sm block" data-testid={`text-invoice-item-desc-${item.id}`}>{item.description || "—"}</span>
                        {item.serviceUrl && (
                          <a
                            href={item.serviceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                            data-testid={`link-invoice-item-service-${item.id}`}
                          >
                            <ServerCog className="w-3 h-3" />
                            View service
                          </a>
                        )}
                      </div>
                      <span className="text-sm font-medium shrink-0" data-testid={`text-invoice-item-amount-${item.id}`}>
                        {formatMoney(item.amount, invoice.currencyCode)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Totals breakdown */}
            <div className="rounded-md border p-3 space-y-1.5">
              {invoice.subtotal != null && (
                <TotalsRow label="Subtotal" value={formatMoney(invoice.subtotal, invoice.currencyCode)} testid="text-invoice-detail-subtotal" />
              )}
              {invoice.tax != null && (
                <TotalsRow
                  label={invoice.taxRate ? `Tax (${invoice.taxRate}%)` : "Tax"}
                  value={formatMoney(invoice.tax, invoice.currencyCode)}
                  testid="text-invoice-detail-tax"
                />
              )}
              {invoice.tax2 != null && Number(invoice.tax2) !== 0 && (
                <TotalsRow
                  label={invoice.taxRate2 ? `Tax 2 (${invoice.taxRate2}%)` : "Tax 2"}
                  value={formatMoney(invoice.tax2, invoice.currencyCode)}
                  testid="text-invoice-detail-tax2"
                />
              )}
              {invoice.credit != null && Number(invoice.credit) !== 0 && (
                <TotalsRow label="Credit" value={formatMoney(invoice.credit, invoice.currencyCode)} testid="text-invoice-detail-credit" />
              )}
              <TotalsRow label="Total" value={formatMoney(invoice.total, invoice.currencyCode)} strong testid="text-invoice-detail-total-row" />
              {invoice.balance != null && (
                <TotalsRow label="Balance due" value={formatMoney(invoice.balance, invoice.currencyCode)} testid="text-invoice-detail-balance" />
              )}
            </div>

            {invoice.notes && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-invoice-detail-notes">{invoice.notes}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              {pdfProxyUrl && (
                <a href={pdfProxyUrl} target="_blank" rel="noopener noreferrer" data-testid="link-invoice-detail-pdf">
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <FileText className="w-3.5 h-3.5" />
                    View PDF
                  </Button>
                </a>
              )}
              {pdfProxyUrl && (
                <a
                  href={`${pdfProxyUrl}?download=1`}
                  download={`invoice-${invoice.id}.pdf`}
                  data-testid="link-invoice-detail-pdf-download"
                >
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    Download PDF
                  </Button>
                </a>
              )}
              {needsPay && invoice.payUrl && (
                <a
                  href={invoice.payUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    onPayClick?.();
                    if (enableSso) {
                      e.preventDefault();
                      void openWhmcsPay(`/api/billing/invoices/${invoice.id}/pay-link`, invoice.payUrl!);
                    }
                  }}
                  data-testid="link-invoice-detail-pay"
                >
                  <Button size="sm" className="gap-1.5">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Pay now
                  </Button>
                </a>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The renewed-service tag shown under an invoice row: a deep link to the WHMCS
 * service detail page when we have one, otherwise a plain name, otherwise
 * nothing. Shared by the server-labelled rows and the lazy-loaded ones so both
 * render identically.
 */
function InvoiceServiceTag({
  invoiceId,
  serviceUrl,
  serviceName,
}: {
  invoiceId: number;
  serviceUrl: string | null | undefined;
  serviceName: string | null | undefined;
}) {
  if (serviceUrl) {
    return (
      <a
        href={serviceUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
        data-testid={`link-invoice-service-${invoiceId}`}
      >
        <ServerCog className="w-3 h-3 shrink-0" />
        <span className="truncate">{serviceName || "View service"}</span>
      </a>
    );
  }
  if (serviceName) {
    return (
      <span
        className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5 max-w-full"
        data-testid={`text-invoice-service-${invoiceId}`}
      >
        <ServerCog className="w-3 h-3 shrink-0" />
        <span className="truncate">{serviceName}</span>
      </span>
    );
  }
  return null;
}

/**
 * Renders the renewed-service label for one invoice row. When the server already
 * labelled the invoice (the first cap-many invoices are correlated up-front), it
 * renders that immediately. Otherwise — older invoices in a long billing history
 * — it lazily fetches the label from the per-invoice service endpoint, but only
 * once the row scrolls into view (IntersectionObserver), so a customer with
 * hundreds of invoices never triggers a large up-front WHMCS fan-out. Degrades
 * silently: an invoice with no single renewed service (or that can't be loaded)
 * simply shows no label.
 */
export function InvoiceServiceLabel({
  invoice,
  context,
  userId,
}: {
  invoice: BillingInvoice;
  context: "customer" | "admin";
  userId?: string;
}) {
  const hasServerLabel = !!(invoice.serviceUrl || invoice.serviceName);
  const [shouldLoad, setShouldLoad] = useState(false);
  const ref = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (hasServerLabel || shouldLoad) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasServerLabel, shouldLoad]);

  const isAdmin = context === "admin";
  const queryKey =
    isAdmin && userId
      ? ["/api/admin/users", userId, "whmcs", "billing", "invoices", String(invoice.id), "service"]
      : ["/api/billing/invoices", String(invoice.id), "service"];

  const { data } = useQuery<InvoiceServicePayload>({
    queryKey,
    enabled: !hasServerLabel && shouldLoad,
    staleTime: 5 * 60 * 1000,
  });

  if (hasServerLabel) {
    return (
      <InvoiceServiceTag
        invoiceId={invoice.id}
        serviceUrl={invoice.serviceUrl}
        serviceName={invoice.serviceName}
      />
    );
  }

  const lazy = data?.service ?? null;
  return (
    <span ref={ref} data-testid={`invoice-service-lazy-${invoice.id}`}>
      {lazy && (
        <InvoiceServiceTag
          invoiceId={invoice.id}
          serviceUrl={lazy.serviceUrl}
          serviceName={lazy.serviceName}
        />
      )}
    </span>
  );
}

type CancellationType = "End of Billing Period" | "Immediate";

/**
 * Customer-only confirm dialog for requesting cancellation of an active service.
 * Lets the customer pick the cancellation timing and add an optional reason, then
 * POSTs to /api/billing/services/:id/cancel. The server re-checks ownership +
 * active status before touching WHMCS, so this is just the friendly front door.
 * Pending/disabled while submitting; success + error toasts; never leaves the
 * billing view half-done (the dialog closes only on success).
 */
function CancelServiceDialog({
  product,
  open,
  onClose,
}: {
  product: BillingProduct | null;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [type, setType] = useState<CancellationType>("End of Billing Period");
  const [reason, setReason] = useState("");

  const idempotency = useIdempotencyKey();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("No service selected");
      const res = await apiRequest(
        "POST",
        `/api/billing/services/${product.id}/cancel`,
        {
          type,
          reason: reason.trim() || undefined,
        },
        { idempotencyKey: idempotency.getKey() },
      );
      return res.json() as Promise<{ ok: boolean; message?: string }>;
    },
    onSuccess: (result) => {
      idempotency.reset();
      toast({
        title: "Cancellation request received",
        description:
          result.message ??
          "We've passed your request on to billing. You'll be notified once it's processed.",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
      handleClose();
    },
    onError: (e: Error) => {
      const timedOut = isTimeoutError(e);
      // Keep the key on a timeout so the user's retry is deduped; rotate it on any
      // other failure so a corrected resubmission starts a fresh attempt.
      if (!timedOut) idempotency.reset();
      toast({
        title: timedOut ? "Your cancellation may have gone through" : "Couldn't submit your request",
        description: timedOut
          ? paymentTimeoutMessage("services")
          : serverActionErrorMessage(
              e,
              "We couldn't reach billing right now. Please try again shortly.",
            ),
        variant: "destructive",
      });
    },
  });

  function handleClose() {
    if (mutation.isPending) return;
    setType("End of Billing Period");
    setReason("");
    onClose();
  }

  const submitting = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-cancel-service">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-destructive" />
            Request cancellation
          </DialogTitle>
          <DialogDescription data-testid="text-cancel-service-name">
            {product
              ? `You're about to request cancellation of "${product.name}". This stops the service and you'll no longer be billed for it.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium mb-2">When should it be cancelled?</p>
            <RadioGroup
              value={type}
              onValueChange={(v) => setType(v as CancellationType)}
              className="space-y-2"
            >
              <div className="flex items-start gap-2.5 rounded-md border p-3">
                <RadioGroupItem value="End of Billing Period" id="cancel-eobp" className="mt-0.5" data-testid="radio-cancel-end-of-period" />
                <Label htmlFor="cancel-eobp" className="font-normal cursor-pointer">
                  <span className="font-medium">At the end of the billing period</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Keep using the service until the period you've already paid for runs out.
                  </span>
                </Label>
              </div>
              <div className="flex items-start gap-2.5 rounded-md border p-3">
                <RadioGroupItem value="Immediate" id="cancel-immediate" className="mt-0.5" data-testid="radio-cancel-immediate" />
                <Label htmlFor="cancel-immediate" className="font-normal cursor-pointer">
                  <span className="font-medium">Immediately</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Cancel right away. You may lose access before the current period ends.
                  </span>
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div>
            <Label htmlFor="cancel-reason" className="text-sm font-medium">
              Reason <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <Textarea
              id="cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Let us know why you're cancelling (optional)"
              maxLength={1000}
              rows={3}
              className="mt-1.5 resize-none"
              data-testid="input-cancel-reason"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting} data-testid="button-cancel-dismiss">
            Keep service
          </Button>
          <Button
            variant="destructive"
            onClick={() => mutation.mutate()}
            disabled={submitting}
            data-testid="button-cancel-confirm"
          >
            {submitting ? "Submitting..." : "Request cancellation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AdminServiceAction = "suspend" | "unsuspend" | "terminate";

const ADMIN_ACTION_COPY: Record<
  AdminServiceAction,
  { title: string; verb: string; confirm: string; pendingLabel: string; doneTitle: string; destructive: boolean }
> = {
  suspend: {
    title: "Suspend service",
    verb: "suspend",
    confirm: "Suspend service",
    pendingLabel: "Suspending...",
    doneTitle: "Service suspended",
    destructive: false,
  },
  unsuspend: {
    title: "Unsuspend service",
    verb: "unsuspend",
    confirm: "Unsuspend service",
    pendingLabel: "Unsuspending...",
    doneTitle: "Service unsuspended",
    destructive: false,
  },
  terminate: {
    title: "Terminate service",
    verb: "terminate",
    confirm: "Terminate service",
    pendingLabel: "Terminating...",
    doneTitle: "Service terminated",
    destructive: true,
  },
};

/**
 * Admin-only dialog to suspend / unsuspend / terminate a customer's WHMCS
 * service. Hits the permission-gated admin endpoint; terminate requires an
 * explicit confirm (the dialog itself is the confirmation step) and is styled
 * destructive. Suspend optionally carries a reason shown to the customer.
 */
function AdminServiceActionDialog({
  product,
  action,
  userId,
  open,
  onClose,
}: {
  product: BillingProduct | null;
  action: AdminServiceAction | null;
  userId?: string;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const copy = action ? ADMIN_ACTION_COPY[action] : null;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!product || !action || !userId) throw new Error("No service selected");
      const res = await apiRequest(
        "POST",
        `/api/admin/users/${userId}/whmcs/services/${product.id}/${action}`,
        action === "suspend" ? { reason: reason.trim() || undefined } : undefined,
      );
      return res.json() as Promise<{ ok: boolean; message?: string }>;
    },
    onSuccess: (result) => {
      toast({
        title: copy?.doneTitle ?? "Done",
        description: result.message ?? "The change has been applied.",
      });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId, "whmcs", "billing"] });
      }
      handleClose();
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't complete that action",
        description: serverActionErrorMessage(
          e,
          "Something went wrong reaching billing. Please try again shortly.",
        ),
        variant: "destructive",
      });
    },
  });

  function handleClose() {
    if (mutation.isPending) return;
    setReason("");
    onClose();
  }

  const submitting = mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md" data-testid="dialog-admin-service-action">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {copy?.destructive && <AlertTriangle className="w-5 h-5 text-destructive" />}
            {copy?.title ?? "Service action"}
          </DialogTitle>
          <DialogDescription data-testid="text-admin-action-service-name">
            {product && copy
              ? `You're about to ${copy.verb} "${product.name}" for this customer.${
                  copy.destructive
                    ? " This permanently ends the service and cannot be undone."
                    : ""
                }`
              : ""}
          </DialogDescription>
        </DialogHeader>

        {action === "suspend" && (
          <div>
            <Label htmlFor="admin-suspend-reason" className="text-sm font-medium">
              Reason <span className="text-muted-foreground font-normal">(optional, shown to the customer)</span>
            </Label>
            <Input
              id="admin-suspend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Overdue invoice"
              maxLength={255}
              className="mt-1.5"
              data-testid="input-admin-suspend-reason"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={handleClose} disabled={submitting} data-testid="button-admin-action-dismiss">
            Cancel
          </Button>
          <Button
            variant={copy?.destructive ? "destructive" : "default"}
            onClick={() => mutation.mutate()}
            disabled={submitting}
            data-testid="button-admin-action-confirm"
          >
            {submitting ? copy?.pendingLabel ?? "Working..." : copy?.confirm ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type TransactionTypeFilter = "all" | "payments" | "refunds";

/**
 * Customer-only payment / refund history with lightweight, client-side filtering
 * over the already-loaded transaction list — no extra endpoint. Supports a free
 * text search (description + gateway), a payments / refunds type toggle, and an
 * optional date range. Every degraded state (unreachable, empty list, no matches)
 * renders cleanly.
 */
function PaymentHistory({
  transactions,
  transactionsUnreachable,
  onSelectInvoice,
}: {
  transactions: BillingTransaction[] | undefined;
  transactionsUnreachable: boolean | undefined;
  /** Open the invoice detail dialog for a transaction's linked invoice. */
  onSelectInvoice: (invoiceId: number) => void;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TransactionTypeFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const all = transactions ?? [];
  const hasAny = all.length > 0;

  const query = search.trim().toLowerCase();
  const filtered = all.filter((t) => {
    if (query) {
      const haystack = `${t.description ?? ""} ${t.gateway ?? ""}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (typeFilter === "payments" && !t.amountIn) return false;
    if (typeFilter === "refunds" && !t.amountOut) return false;
    // Dates are ISO (YYYY-MM-DD), so string comparison sorts chronologically.
    if (fromDate) {
      if (!t.date || t.date < fromDate) return false;
    }
    if (toDate) {
      if (!t.date || t.date > toDate) return false;
    }
    return true;
  });

  const filtersActive =
    query !== "" || typeFilter !== "all" || fromDate !== "" || toDate !== "";

  function clearFilters() {
    setSearch("");
    setTypeFilter("all");
    setFromDate("");
    setToDate("");
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <History className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold" data-testid="heading-billing-transactions">Payment history</h2>
      </div>

      {transactionsUnreachable ? (
        <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-billing-transactions-unreachable">
          We couldn't load your payment history right now. Please try again in a few minutes.
        </p>
      ) : !hasAny ? (
        <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-billing-no-transactions">
          No transactions yet.
        </p>
      ) : (
        <>
          {/* Filter controls — all client-side over the already-loaded list. */}
          <div className="mb-3 space-y-2" data-testid="billing-transaction-filters">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search description or gateway"
                className="pl-8 h-9"
                data-testid="input-transaction-search"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                type="single"
                value={typeFilter}
                onValueChange={(v) => setTypeFilter((v || "all") as TransactionTypeFilter)}
                className="justify-start"
                data-testid="toggle-transaction-type"
              >
                <ToggleGroupItem value="all" size="sm" data-testid="toggle-transaction-all">All</ToggleGroupItem>
                <ToggleGroupItem value="payments" size="sm" data-testid="toggle-transaction-payments">Payments</ToggleGroupItem>
                <ToggleGroupItem value="refunds" size="sm" data-testid="toggle-transaction-refunds">Refunds</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5">
                <Label htmlFor="transaction-from" className="text-xs text-muted-foreground">From</Label>
                <Input
                  id="transaction-from"
                  type="date"
                  value={fromDate}
                  max={toDate || undefined}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="h-9 w-auto"
                  data-testid="input-transaction-from"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label htmlFor="transaction-to" className="text-xs text-muted-foreground">To</Label>
                <Input
                  id="transaction-to"
                  type="date"
                  value={toDate}
                  min={fromDate || undefined}
                  onChange={(e) => setToDate(e.target.value)}
                  className="h-9 w-auto"
                  data-testid="input-transaction-to"
                />
              </div>
              {filtersActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-1.5"
                  onClick={clearFilters}
                  data-testid="button-clear-transaction-filters"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  Clear
                </Button>
              )}
            </div>
          </div>

          {filtersActive && (
            <p className="text-xs text-muted-foreground px-1 mb-2" data-testid="text-transaction-result-count">
              Showing {filtered.length} of {all.length} transactions
            </p>
          )}

          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-billing-no-matching-transactions">
              No transactions match your filters.
            </p>
          ) : (
            <div className="space-y-2">
              {filtered.map((t) => {
                const amount = t.amountIn ? (
                  <span className="font-semibold text-sm text-green-700 dark:text-green-400" data-testid={`text-transaction-amount-in-${t.id}`}>
                    +{formatMoney(t.amountIn, t.currencyCode)}
                  </span>
                ) : t.amountOut ? (
                  <span className="font-semibold text-sm text-destructive" data-testid={`text-transaction-amount-out-${t.id}`}>
                    -{formatMoney(t.amountOut, t.currencyCode)}
                  </span>
                ) : (
                  <span className="font-semibold text-sm" data-testid={`text-transaction-amount-${t.id}`}>—</span>
                );
                const details = (
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate" data-testid={`text-transaction-desc-${t.id}`}>
                      {t.description || t.gateway || "Payment"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {formatDate(t.date)}
                      {t.gateway && t.description ? ` · ${t.gateway}` : ""}
                    </p>
                    {t.serviceUrl ? (
                      <a
                        href={t.serviceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-0.5"
                        data-testid={`link-transaction-service-${t.id}`}
                      >
                        <ServerCog className="w-3 h-3 shrink-0" />
                        <span className="truncate">{t.serviceName || "View service"}</span>
                      </a>
                    ) : t.serviceName ? (
                      <p
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground mt-0.5 max-w-full"
                        data-testid={`text-transaction-service-${t.id}`}
                      >
                        <ServerCog className="w-3 h-3 shrink-0" />
                        <span className="truncate">{t.serviceName}</span>
                      </p>
                    ) : null}
                  </div>
                );
                return (
                  <Card key={t.id} data-testid={`card-billing-transaction-${t.id}`}>
                    <CardContent className="p-3">
                      {t.invoiceId != null ? (
                        <button
                          type="button"
                          onClick={() => onSelectInvoice(t.invoiceId!)}
                          className="w-full flex items-center justify-between gap-3 text-left hover-elevate active-elevate-2 -m-3 p-3 rounded-md"
                          data-testid={`button-transaction-invoice-${t.id}`}
                        >
                          {details}
                          <div className="flex items-center gap-2 shrink-0">
                            {amount}
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </div>
                        </button>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          {details}
                          <div className="text-right shrink-0">{amount}</div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

interface BillingSummaryViewProps {
  data: BillingSummary | undefined;
  isLoading: boolean;
  /** "customer" tweaks copy to second-person; "admin" is about the customer. */
  context?: "customer" | "admin";
  /** Required in admin context to fetch a single invoice for that customer. */
  userId?: string;
}

export function BillingSummaryView({ data, isLoading, context = "customer", userId }: BillingSummaryViewProps) {
  const { toast } = useToast();
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  // Long invoice histories collapse to the newest few; "Show all" reveals the
  // rest so the page stays compact on mobile while the full history is one tap
  // away.
  const [showAllInvoices, setShowAllInvoices] = useState(false);
  const [cancelProduct, setCancelProduct] = useState<BillingProduct | null>(null);
  const [adminAction, setAdminAction] = useState<{ product: BillingProduct; action: AdminServiceAction } | null>(null);
  // Persistent "Payment received" confirmation shown after returning from WHMCS's
  // off-site checkout. A toast alone is easy to miss (it auto-dismisses, and the
  // payment happens in a SEPARATE tab so the customer may glance away), so we also
  // surface a dismissible success banner at the top of the page until they ack it.
  const [paymentConfirmation, setPaymentConfirmation] = useState<{
    title: string;
    description: string;
  } | null>(null);
  // Neutral counterpart to the success banner: shown when the customer returned
  // from WHMCS's hosted checkout WITHOUT paying (cancelled / closed the tab) and
  // an invoice is still outstanding, so the silent screen doesn't leave them
  // wondering whether anything was charged.
  const [noPaymentNotice, setNoPaymentNotice] = useState(false);
  // Client-side invoice ordering. Default keeps the server's strict newest-first
  // order; "outstanding" floats bills that need action to the top. Persisted to
  // localStorage so the customer's choice sticks across visits/reloads; never
  // triggers an extra API call.
  const [invoiceSort, setInvoiceSort] = useState<InvoiceSortMode>(() => {
    try {
      const stored = window.localStorage.getItem(INVOICE_SORT_STORAGE_KEY);
      if (stored === "newest" || stored === "outstanding") return stored;
    } catch {}
    return "newest";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(INVOICE_SORT_STORAGE_KEY, invoiceSort);
    } catch {}
  }, [invoiceSort]);

  // Payments happen on WHMCS's off-site hosted checkout (the pay links open in a
  // new tab), so our server never sees them and the per-client billing cache can
  // keep showing the just-paid invoice for up to its TTL. When the customer
  // follows a pay link we flag it, and the moment this tab regains focus we force
  // a fresh server-side load (POST /api/billing/refresh drops only the session
  // user's own cache) and refetch — so the settled invoice shows immediately.
  // We snapshot what's outstanding BEFORE the refresh and compare against the
  // freshly-loaded data afterward; if an invoice that was due is now Paid (or the
  // outstanding total dropped) we confirm it with a toast — without false
  // positives when nothing actually settled.
  const payClickedRef = useRef(false);
  const refreshingRef = useRef(false);
  useEffect(() => {
    if (context === "admin") return;
    const onFocus = async () => {
      if (document.visibilityState !== "visible") return;
      if (!payClickedRef.current) return;
      payClickedRef.current = false;
      if (refreshingRef.current) return;
      refreshingRef.current = true;
      const before = summarizeOutstanding(
        queryClient.getQueryData<BillingSummary>(["/api/billing"]),
      );
      // Clear any stale notice from a previous return before re-evaluating.
      setNoPaymentNotice(false);
      let settled = false;
      try {
        // WHMCS can lag a beat behind the customer returning — the gateway
        // callback that flips the invoice to Paid may land just after they
        // switch tabs back. A single refresh would then miss it and leave them
        // unsure. Re-check a few times (short backoff) before giving up so a
        // genuine payment reliably surfaces a confirmation.
        const MAX_ATTEMPTS = 3;
        for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
          await apiRequest("POST", "/api/billing/refresh").catch(() => {});
          await queryClient.invalidateQueries({ queryKey: ["/api/billing"] });
          const after = queryClient.getQueryData<BillingSummary>(["/api/billing"]);
          const result = classifyPaymentSettlement(before, after);
          if (result.settled) {
            const confirmation = result.fullyCleared
              ? {
                  title: "Payment received — thanks!",
                  description:
                    "Your payment went through and you're all paid up.",
                }
              : {
                  title: "Payment received — thanks!",
                  description:
                    "Your payment went through. You still have an outstanding balance below.",
                };
            setPaymentConfirmation(confirmation);
            toast(confirmation);
            settled = true;
            break;
          }
          // Nothing detected yet — wait briefly and try again (unless last).
          if (attempt < MAX_ATTEMPTS - 1) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
          }
        }
        // The retry window closed without a payment landing. If the customer
        // clearly had something to pay and it's still outstanding, reassure them
        // that nothing was charged (cancelled / abandoned checkout).
        if (!settled) {
          const after = queryClient.getQueryData<BillingSummary>(["/api/billing"]);
          if (shouldShowNoPaymentNotice(before, after)) {
            setNoPaymentNotice(true);
          }
        }
      } finally {
        refreshingRef.current = false;
      }
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("focus", onFocus);
    };
  }, [context, toast]);
  const markPayClicked = () => {
    payClickedRef.current = true;
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="billing-loading">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Billing unavailable"
        description="We couldn't load billing information right now. Please try again later."
        testid="billing-state-error"
      />
    );
  }

  const isAdmin = context === "admin";

  if (!data.configured || !data.enabled) {
    return (
      <EmptyState
        icon={CreditCard}
        title="Billing not available"
        description={
          isAdmin
            ? "WHMCS billing isn't configured or is currently disabled."
            : "Online billing isn't available right now. Please check back later."
        }
        testid="billing-state-unconfigured"
      />
    );
  }

  if (!data.linked) {
    return (
      <EmptyState
        icon={Link2Off}
        title={isAdmin ? "No billing account linked" : "No billing account linked"}
        description={
          isAdmin
            ? "This customer isn't linked to a WHMCS client yet. Link them above to see invoices and services."
            : "Your account isn't linked to our billing system yet. Please contact support to get connected."
        }
        testid="billing-state-unlinked"
      />
    );
  }

  if (data.unreachable) {
    return (
      <EmptyState
        icon={ServerCog}
        title="Billing temporarily unavailable"
        description="We couldn't reach the billing system right now. Please try again in a few minutes."
        testid="billing-state-unreachable"
      />
    );
  }

  const hasInvoices = data.invoices.length > 0;
  const hasProducts = data.products.length > 0;
  // Sort first (Newest / Outstanding-first), then cap the initial render so a
  // long history doesn't dominate the page; the "Show all" expander below
  // reveals the rest of the sorted list.
  const sortedInvoices = sortInvoices(data.invoices, invoiceSort);
  const INVOICE_PREVIEW_CAP = 5;
  const invoicesCollapsible = sortedInvoices.length > INVOICE_PREVIEW_CAP;
  const visibleInvoices =
    invoicesCollapsible && !showAllInvoices
      ? sortedInvoices.slice(0, INVOICE_PREVIEW_CAP)
      : sortedInvoices;

  return (
    <div className="space-y-4" data-testid="billing-summary">
      {/* Payment received confirmation (persists until dismissed) */}
      {paymentConfirmation && (
        <Card
          className="border-green-500/40 bg-green-500/5"
          data-testid="card-payment-confirmation"
        >
          <CardContent className="p-3 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold text-green-700 dark:text-green-400"
                data-testid="text-payment-confirmation-title"
              >
                {paymentConfirmation.title}
              </p>
              <p
                className="text-xs text-muted-foreground mt-0.5"
                data-testid="text-payment-confirmation-description"
              >
                {paymentConfirmation.description}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 -mt-0.5 -mr-1"
              onClick={() => setPaymentConfirmation(null)}
              aria-label="Dismiss"
              data-testid="button-dismiss-payment-confirmation"
            >
              <X className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* No-payment notice: neutral reassurance after an abandoned / cancelled
          checkout (persists until dismissed). Distinct, calm tone — not the
          green success banner, not an error-red alert. */}
      {noPaymentNotice && (
        <Card
          className="border-muted-foreground/30 bg-muted/40"
          data-testid="card-no-payment-notice"
        >
          <CardContent className="p-3 flex items-start gap-3">
            <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p
                className="text-sm font-semibold"
                data-testid="text-no-payment-notice-title"
              >
                No payment detected
              </p>
              <p
                className="text-xs text-muted-foreground mt-0.5"
                data-testid="text-no-payment-notice-description"
              >
                Nothing was charged and your invoice is still open. You can try
                the payment again whenever you're ready.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 -mt-0.5 -mr-1"
              onClick={() => setNoPaymentNotice(false)}
              aria-label="Dismiss"
              data-testid="button-dismiss-no-payment-notice"
            >
              <X className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Account balance */}
      {data.balance && (() => {
        const due = amountDueAtThisTime(data);
        const dueNum = parseAmount(due.total) ?? 0;
        return (
          <Card data-testid="card-billing-balance">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Wallet className="w-5 h-5 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Account credit balance</p>
                    <p className="text-lg font-semibold truncate" data-testid="text-billing-balance">
                      {formatMoney(data.balance.creditBalance, data.balance.currencyCode)}
                    </p>
                  </div>
                </div>
                {data.portalUrl && (
                  <a href={data.portalUrl} target="_blank" rel="noopener noreferrer" data-testid="link-billing-portal">
                    <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
                      <ExternalLink className="w-3.5 h-3.5" />
                      Billing portal
                    </Button>
                  </a>
                )}
              </div>
              <div className="flex items-center gap-3 min-w-0 border-t pt-3">
                <div
                  className={`w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 ${
                    dueNum > 0 ? "bg-destructive/10" : "bg-primary/10"
                  }`}
                >
                  <CreditCard className={`w-5 h-5 ${dueNum > 0 ? "text-destructive" : "text-primary"}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Amount due at this time</p>
                  <p
                    className={`text-lg font-semibold truncate ${dueNum > 0 ? "text-destructive" : ""}`}
                    data-testid="text-billing-amount-due"
                  >
                    {formatMoney(due.total, due.currencyCode)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Invoices — kept directly under the balance so the thing you pay sits
          next to the amount you owe. */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Receipt className="w-4 h-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold" data-testid="heading-billing-invoices">Invoices</h2>
          </div>
          {hasInvoices && (
            <ToggleGroup
              type="single"
              size="sm"
              value={invoiceSort}
              onValueChange={(v) => {
                if (v) setInvoiceSort(v as InvoiceSortMode);
              }}
              className="shrink-0"
              aria-label="Sort invoices"
              data-testid="toggle-invoice-sort"
            >
              <ToggleGroupItem
                value="newest"
                className="h-7 px-2.5 text-xs"
                data-testid="toggle-invoice-sort-newest"
              >
                Newest first
              </ToggleGroupItem>
              <ToggleGroupItem
                value="outstanding"
                className="h-7 px-2.5 text-xs"
                data-testid="toggle-invoice-sort-outstanding"
              >
                Outstanding first
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
        {data.payAll && data.payAll.url && (
          <Card className="border-destructive/40 mb-2" data-testid="card-pay-all-outstanding">
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold" data-testid="text-pay-all-count">
                  {data.payAll.count} outstanding invoices
                </p>
                <p className="text-xs text-muted-foreground">
                  Total owed{" "}
                  <span className="font-medium text-foreground" data-testid="text-pay-all-total">
                    {formatMoney(data.payAll.total, data.payAll.currencyCode)}
                  </span>
                </p>
              </div>
              <a
                href={data.payAll.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  markPayClicked();
                  if (!isAdmin) {
                    e.preventDefault();
                    void openWhmcsPay("/api/billing/pay-all-link", data.payAll!.url!);
                  }
                }}
                data-testid="link-pay-all-outstanding"
              >
                <Button size="sm" className="gap-1.5 shrink-0">
                  <CreditCard className="w-3.5 h-3.5" />
                  Pay all outstanding
                </Button>
              </a>
            </CardContent>
          </Card>
        )}
        {!hasInvoices ? (
          <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-billing-no-invoices">
            No invoices yet.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleInvoices.map((inv) => {
              const needsPay = inv.status === "unpaid" || inv.status === "overdue";
              return (
                <Card
                  key={inv.id}
                  className={needsPay ? "border-destructive/40" : undefined}
                  data-testid={`card-billing-invoice-${inv.id}`}
                >
                  <CardContent className="p-3">
                    <button
                      type="button"
                      onClick={() => setSelectedInvoiceId(inv.id)}
                      className="w-full flex items-center justify-between gap-3 text-left hover-elevate active-elevate-2 -m-3 p-3 rounded-md"
                      data-testid={`button-invoice-detail-${inv.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-invoice-num-${inv.id}`}>
                          #{inv.invoiceNum}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDate(inv.date)}
                          {inv.dueDate ? ` · Due ${formatDate(inv.dueDate)}` : ""}
                        </p>
                        <InvoiceServiceLabel invoice={inv} context={context} userId={userId} />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex flex-col items-end gap-1">
                          <span className="font-semibold text-sm" data-testid={`text-invoice-total-${inv.id}`}>
                            {formatMoney(inv.total, inv.currencyCode)}
                          </span>
                          <Badge variant="outline" className={invoiceBadgeClass(inv.status)} data-testid={`badge-invoice-status-${inv.id}`}>
                            {INVOICE_STATUS_LABEL[inv.status]}
                          </Badge>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </button>
                    {needsPay && inv.payUrl && (
                      <div className="mt-2.5 flex justify-end">
                        <a
                          href={inv.payUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            markPayClicked();
                            if (!isAdmin) {
                              e.preventDefault();
                              void openWhmcsPay(`/api/billing/invoices/${inv.id}/pay-link`, inv.payUrl!);
                            }
                          }}
                          data-testid={`link-invoice-pay-${inv.id}`}
                        >
                          <Button size="sm" className="gap-1.5 h-8">
                            <ExternalLink className="w-3.5 h-3.5" />
                            Pay in billing portal
                          </Button>
                        </a>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
            {invoicesCollapsible && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full gap-1.5"
                onClick={() => setShowAllInvoices((prev) => !prev)}
                data-testid="button-toggle-all-invoices"
              >
                {showAllInvoices ? (
                  <>
                    <ChevronUp className="w-4 h-4" />
                    Show fewer invoices
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" />
                    Show all invoices ({data.invoices.length})
                  </>
                )}
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Payment history (customer self-view only) */}
      {context === "customer" && (
        <PaymentHistory
          transactions={data.transactions}
          transactionsUnreachable={data.transactionsUnreachable}
          onSelectInvoice={setSelectedInvoiceId}
        />
      )}

      {/* Products / services */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold" data-testid="heading-billing-products">Products &amp; Services</h2>
        </div>
        {!hasProducts ? (
          <p className="text-sm text-muted-foreground px-1 py-3" data-testid="text-billing-no-products">
            No active products or services.
          </p>
        ) : (
          <div className="space-y-2">
            {data.products.map((p) => {
              // Customers can request cancellation of their OWN active services.
              // Hidden in the admin (read-only) view and for non-active products.
              const canCancel = !isAdmin && p.status.toLowerCase() === "active";
              // Admin staff lifecycle controls. Mirror the route's status guards:
              // only an active service can be suspended, only a suspended one
              // unsuspended; terminate is offered on anything not already gone.
              const pStatus = p.status.toLowerCase();
              const canSuspend = isAdmin && pStatus === "active";
              const canUnsuspend = isAdmin && pStatus === "suspended";
              const canTerminate = isAdmin && pStatus !== "terminated";
              const hasAdminActions = canSuspend || canUnsuspend || canTerminate;
              return (
                <Card key={p.id} data-testid={`card-billing-product-${p.id}`}>
                  <CardContent className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate" data-testid={`text-product-name-${p.id}`}>{p.name}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {p.domain ? `${p.domain} · ` : ""}
                          {p.billingCycle || "—"}
                          {p.amount ? ` · ${formatMoney(p.amount, null)}` : ""}
                        </p>
                        {p.nextDueDate && (
                          <p className="text-xs text-muted-foreground mt-0.5" data-testid={`text-product-due-${p.id}`}>
                            Next due {formatDate(p.nextDueDate)}
                          </p>
                        )}
                      </div>
                      <Badge variant="outline" className={`shrink-0 ${productBadgeClass(p.status)}`} data-testid={`badge-product-status-${p.id}`}>
                        {p.status || "—"}
                      </Badge>
                    </div>
                    {canCancel && (
                      <div className="mt-2.5 flex justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 h-8 text-destructive hover:text-destructive"
                          onClick={() => setCancelProduct(p)}
                          data-testid={`button-request-cancel-${p.id}`}
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Request cancellation
                        </Button>
                      </div>
                    )}
                    {hasAdminActions && (
                      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
                        {canSuspend && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8"
                            onClick={() => setAdminAction({ product: p, action: "suspend" })}
                            data-testid={`button-admin-suspend-${p.id}`}
                          >
                            <PauseCircle className="w-3.5 h-3.5" />
                            Suspend
                          </Button>
                        )}
                        {canUnsuspend && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8"
                            onClick={() => setAdminAction({ product: p, action: "unsuspend" })}
                            data-testid={`button-admin-unsuspend-${p.id}`}
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                            Unsuspend
                          </Button>
                        )}
                        {canTerminate && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 h-8 text-destructive hover:text-destructive"
                            onClick={() => setAdminAction({ product: p, action: "terminate" })}
                            data-testid={`button-admin-terminate-${p.id}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Terminate
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <InvoiceDetailDialog
        invoiceId={selectedInvoiceId}
        context={context}
        userId={userId}
        onClose={() => setSelectedInvoiceId(null)}
        onPayClick={isAdmin ? undefined : markPayClicked}
        enableSso={!isAdmin}
      />

      {!isAdmin && (
        <CancelServiceDialog
          product={cancelProduct}
          open={cancelProduct != null}
          onClose={() => setCancelProduct(null)}
        />
      )}

      {isAdmin && (
        <AdminServiceActionDialog
          product={adminAction?.product ?? null}
          action={adminAction?.action ?? null}
          userId={userId}
          open={adminAction != null}
          onClose={() => setAdminAction(null)}
        />
      )}
    </div>
  );
}
