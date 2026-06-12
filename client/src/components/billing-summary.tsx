import { useState } from "react";
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
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  XCircle,
  AlertTriangle,
  History,
  Search,
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
}: {
  invoiceId: number | null;
  context: "customer" | "admin";
  userId?: string;
  onClose: () => void;
}) {
  const isAdmin = context === "admin";
  const queryKey =
    isAdmin && userId
      ? ["/api/admin/users", userId, "whmcs", "billing", "invoices", String(invoiceId)]
      : ["/api/billing/invoices", String(invoiceId)];

  const { data, isLoading } = useQuery<InvoiceDetailPayload>({
    queryKey,
    enabled: invoiceId != null,
  });

  const invoice = data?.invoice ?? null;
  const needsPay = invoice && (invoice.status === "unpaid" || invoice.status === "overdue");

  // The official WHMCS PDF, streamed through our own proxy so the customer never
  // gets bounced to a WHMCS client-area login. The proxy enforces ownership
  // against the linked client, so we only build the URL when we have an invoice.
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
                      <span className="text-sm min-w-0" data-testid={`text-invoice-item-desc-${item.id}`}>{item.description || "—"}</span>
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
                <a href={invoice.payUrl} target="_blank" rel="noopener noreferrer" data-testid="link-invoice-detail-pay">
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

  const mutation = useMutation({
    mutationFn: async () => {
      if (!product) throw new Error("No service selected");
      const res = await apiRequest("POST", `/api/billing/services/${product.id}/cancel`, {
        type,
        reason: reason.trim() || undefined,
      });
      return res.json() as Promise<{ ok: boolean; message?: string }>;
    },
    onSuccess: (result) => {
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
      toast({
        title: "Couldn't submit your request",
        description: e.message,
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
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<number | null>(null);
  const [cancelProduct, setCancelProduct] = useState<BillingProduct | null>(null);
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

  return (
    <div className="space-y-4" data-testid="billing-summary">
      {/* Account balance */}
      {data.balance && (
        <Card data-testid="card-billing-balance">
          <CardContent className="p-4 flex items-center justify-between gap-3">
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
          </CardContent>
        </Card>
      )}

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
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Invoices */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Receipt className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold" data-testid="heading-billing-invoices">Invoices</h2>
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
            {data.invoices.map((inv) => {
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
                        <a href={inv.payUrl} target="_blank" rel="noopener noreferrer" data-testid={`link-invoice-pay-${inv.id}`}>
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
          </div>
        )}
      </div>

      <InvoiceDetailDialog
        invoiceId={selectedInvoiceId}
        context={context}
        userId={userId}
        onClose={() => setSelectedInvoiceId(null)}
      />

      {!isAdmin && (
        <CancelServiceDialog
          product={cancelProduct}
          open={cancelProduct != null}
          onClose={() => setCancelProduct(null)}
        />
      )}
    </div>
  );
}
