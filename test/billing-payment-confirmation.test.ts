import { test } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeOutstanding,
  detectPaymentSettled,
  type BillingSummary,
  type BillingInvoice,
  type InvoiceStatus,
} from "../client/src/components/billing-summary";

// Covers the "Payment received" confirmation logic added for returning from
// WHMCS's off-site hosted checkout (client/src/components/billing-summary.tsx).
// summarizeOutstanding snapshots what's still owed BEFORE the forced refresh;
// detectPaymentSettled compares that snapshot to the freshly-loaded data and
// only reports a settled payment when something actually changed — no false
// positives when nothing moved.

function inv(id: number, status: InvoiceStatus, total = "10.00"): BillingInvoice {
  return {
    id,
    invoiceNum: `INV-${id}`,
    date: null,
    dueDate: null,
    datePaid: null,
    total,
    balance: null,
    currencyCode: "USD",
    status,
    rawStatus: status,
    payUrl: null,
  };
}

function summary(
  invoices: BillingInvoice[],
  payAllTotal: string | null,
): BillingSummary {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    client: { id: 1, name: "Test", status: "Active" },
    balance: null,
    invoices,
    products: [],
    portalUrl: null,
    payAll: payAllTotal == null
      ? null
      : { count: 1, total: payAllTotal, currencyCode: "USD", url: null },
  };
}

test("summarizeOutstanding collects unpaid + overdue invoices and the pay-all total", () => {
  const d = summary(
    [inv(1, "unpaid"), inv(2, "overdue"), inv(3, "paid"), inv(4, "cancelled")],
    "$25.00 USD",
  );
  const snap = summarizeOutstanding(d);
  assert.deepEqual(snap.outstandingInvoiceIds.sort(), [1, 2]);
  assert.equal(snap.outstandingTotal, 25);
});

test("summarizeOutstanding handles undefined data and missing payAll", () => {
  assert.deepEqual(summarizeOutstanding(undefined), {
    outstandingInvoiceIds: [],
    outstandingTotal: null,
  });
  const snap = summarizeOutstanding(summary([inv(1, "paid")], null));
  assert.deepEqual(snap.outstandingInvoiceIds, []);
  assert.equal(snap.outstandingTotal, null);
});

test("detectPaymentSettled is true when an outstanding invoice is now paid", () => {
  const before = summarizeOutstanding(summary([inv(1, "unpaid")], "$10.00 USD"));
  const after = summary([inv(1, "paid")], null);
  assert.equal(detectPaymentSettled(before, after), true);
});

test("detectPaymentSettled is true when the outstanding total drops", () => {
  const before = summarizeOutstanding(
    summary([inv(1, "unpaid"), inv(2, "unpaid")], "$20.00 USD"),
  );
  // One paid off; total halved, but invoice 2 still outstanding.
  const after = summary([inv(1, "paid"), inv(2, "unpaid")], "$10.00 USD");
  assert.equal(detectPaymentSettled(before, after), true);
});

test("detectPaymentSettled is false when nothing changed (no false positive)", () => {
  const before = summarizeOutstanding(summary([inv(1, "unpaid")], "$10.00 USD"));
  const after = summary([inv(1, "unpaid")], "$10.00 USD");
  assert.equal(detectPaymentSettled(before, after), false);
});

test("detectPaymentSettled does NOT count a cancellation as a payment", () => {
  const before = summarizeOutstanding(summary([inv(1, "unpaid")], "$10.00 USD"));
  // Invoice went unpaid -> cancelled, and pay-all cleared. Not a payment.
  const after = summary([inv(1, "cancelled")], null);
  assert.equal(detectPaymentSettled(before, after), false);
});

test("detectPaymentSettled is false when after data is missing", () => {
  const before = summarizeOutstanding(summary([inv(1, "unpaid")], "$10.00 USD"));
  assert.equal(detectPaymentSettled(before, undefined), false);
});
