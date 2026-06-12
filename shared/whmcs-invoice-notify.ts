// Pure, framework-free helpers for the background "your invoice is due soon /
// overdue" push notifier (mirrors shared/whmcs-notify.ts for billing tickets).
//
// WHMCS invoices are read-on-demand (never stored), so there is no webhook. A
// periodic poller (server/whmcs-invoice-notifier.ts) lists each linked
// customer's invoices and uses these helpers to decide which unpaid invoices
// have crossed into a reminder "stage" the customer hasn't been told about yet.
//
// De-duplication uses an ordered per-invoice STAGE marker (not a date like the
// ticket notifier's SeenMap): an invoice escalates none -> due_soon -> overdue
// and notifies at most once per stage. A paid/cancelled invoice yields a null
// stage and silently drops out.

import {
  renderNotification,
  type NotificationTemplateKey,
  type NotificationTemplateOverride,
} from "./notification-templates";

export type InvoiceStage = "due_soon" | "overdue";

/**
 * Per-invoice map of WHMCS invoice id (string) -> the last stage we already
 * notified the customer about. Deliberately distinct from `SeenMap` (which
 * stores YYYY-MM-DD dates) — invoices dedupe by an ordered stage, not a date.
 */
export type InvoiceStageMap = Record<string, InvoiceStage>;

export interface InvoiceNotifyCandidate {
  id: number;
  /**
   * Derived invoice status (see server/whmcs-billing.ts `deriveInvoiceStatus`).
   * Only "unpaid" / "overdue" can produce a reminder stage; every other status
   * (paid/cancelled/refunded/draft/payment_pending/collections/other) yields
   * null so it never notifies.
   */
  status: string;
  /** Due date as YYYY-MM-DD, or null when WHMCS has no / a zero due date. */
  dueDate: string | null;
  /** Human invoice number for the notification body (optional). */
  invoiceNum?: string;
  /** Outstanding balance as a bare string, e.g. "10.00" (optional). */
  balance?: string | null;
  /** Invoice total as a bare string, e.g. "10.00" (optional). */
  total?: string;
  /** ISO currency code, e.g. "USD" (optional). */
  currencyCode?: string | null;
  /** Absolute WHMCS pay/view URL for this invoice (optional). */
  payUrl?: string | null;
}

export interface InvoiceNotification<T> {
  invoice: T;
  stage: InvoiceStage;
}

/**
 * Numeric rank so "have we already passed this stage?" is a simple compare.
 * none(0) < due_soon(1) < overdue(2). An invoice only ever escalates, so a
 * stage whose rank is greater than the last-notified rank is a fresh reminder.
 */
export function stageRank(stage: InvoiceStage | null): number {
  if (stage === "overdue") return 2;
  if (stage === "due_soon") return 1;
  return 0;
}

/**
 * Return the YYYY-MM-DD date that is `days` days AFTER `from` (a YYYY-MM-DD
 * string), in UTC at day granularity (matching the WHMCS list payload). Used to
 * build the "due soon" window upper bound.
 */
export function addDaysToDateString(from: string, days: number): string {
  const [y, m, d] = from.split("-").map((n) => parseInt(n, 10));
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Decide the reminder stage an invoice is currently in, or null if none.
 *
 *  - Only unpaid (incl. derived-overdue) invoices with a real due date qualify.
 *  - `overdue` when the due date is strictly before today.
 *  - `due_soon` when the due date is today..today+`dueSoonDays` (inclusive).
 *  - null when paid/cancelled/etc, when there is no due date, or when the due
 *    date is still further out than the window.
 *
 * `today` and `dueDate` are both YYYY-MM-DD so lexicographic compares are
 * correct.
 */
export function computeInvoiceStage(
  invoice: InvoiceNotifyCandidate,
  today: string,
  dueSoonDays: number,
): InvoiceStage | null {
  const s = String(invoice.status ?? "").toLowerCase();
  const needsPayment = s === "unpaid" || s === "overdue";
  if (!needsPayment) return null;
  if (!invoice.dueDate) return null;
  if (invoice.dueDate < today) return "overdue";
  const windowEnd = addDaysToDateString(today, dueSoonDays);
  if (invoice.dueDate <= windowEnd) return "due_soon";
  return null;
}

/**
 * Decide which invoices warrant a reminder this pass: those whose current stage
 * rank is strictly greater than the stage we last notified (escalation). The
 * returned objects carry the resolved stage so the caller can pick copy + the
 * marker to persist. An empty `notified` map means every currently-due/overdue
 * invoice is a fresh reminder — correct, because these are live obligations
 * (no historical-blast guard needed, unlike answered tickets).
 */
export function selectInvoicesToNotify<T extends InvoiceNotifyCandidate>(
  invoices: T[],
  notified: InvoiceStageMap,
  today: string,
  dueSoonDays: number,
): InvoiceNotification<T>[] {
  const out: InvoiceNotification<T>[] = [];
  for (const invoice of invoices) {
    const stage = computeInvoiceStage(invoice, today, dueSoonDays);
    if (!stage) continue;
    const prev = notified[String(invoice.id)] ?? null;
    if (stageRank(stage) > stageRank(prev)) out.push({ invoice, stage });
  }
  return out;
}

// --- Customer-facing copy (pure, unit-tested) ---------------------------------

/** Whole days from `today` to `dueDate` (both YYYY-MM-DD), UTC granularity. */
export function daysUntilDue(today: string, dueDate: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(`${dueDate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/** "10.00 USD" from balance ?? total + currency; "" when no amount is known. */
export function invoiceAmountLabel(invoice: InvoiceNotifyCandidate): string {
  const raw = invoice.balance ?? invoice.total ?? "";
  const amount = String(raw).trim();
  const currency = String(invoice.currencyCode ?? "").trim();
  if (!amount) return currency;
  return currency ? `${amount} ${currency}` : amount;
}

/** Short human label for the invoice, e.g. "#1234" (falls back to the id). */
export function invoiceLabel(invoice: InvoiceNotifyCandidate): string {
  const num = String(invoice.invoiceNum ?? "").trim() || String(invoice.id);
  return num.startsWith("#") ? num : `#${num}`;
}

/** "is due today" / "is due tomorrow" / "is due in N days" / "is overdue". */
export function invoiceDuePhrase(stage: InvoiceStage, today: string, dueDate: string | null): string {
  if (stage === "overdue") return "is overdue";
  const d = dueDate ? daysUntilDue(today, dueDate) : 0;
  if (d <= 0) return "is due today";
  if (d === 1) return "is due tomorrow";
  return `is due in ${d} days`;
}

/** Notification-template key for an invoice stage. */
export function invoiceTemplateKey(stage: InvoiceStage): NotificationTemplateKey {
  return stage === "overdue" ? "whmcs.invoice.overdue" : "whmcs.invoice.due_soon";
}

/** Placeholder values for an invoice notification. */
function invoiceVars(
  invoice: InvoiceNotifyCandidate,
  stage: InvoiceStage,
  today: string,
): Record<string, string> {
  return {
    invoice: invoiceLabel(invoice),
    amount: invoiceAmountLabel(invoice),
    when: invoiceDuePhrase(stage, today, invoice.dueDate),
  };
}

/**
 * Notification title for the stage. Delegates to the shared template renderer so
 * an admin override (when supplied) wins over the built-in default.
 */
export function invoiceNotifTitle(
  stage: InvoiceStage,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(invoiceTemplateKey(stage), {}, override).title;
}

/**
 * Body line, e.g. "Invoice #1234 (10.00 USD) is due in 3 days." (admin override
 * wins when supplied; an empty amount collapses cleanly via tidyNotification).
 */
export function invoiceNotifBody(
  invoice: InvoiceNotifyCandidate,
  stage: InvoiceStage,
  today: string,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(invoiceTemplateKey(stage), invoiceVars(invoice, stage, today), override).body;
}
