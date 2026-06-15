import { test } from "node:test";
import assert from "node:assert/strict";
import {
  amountDueAtThisTime,
  type BillingSummary,
  type BillingInvoice,
  type InvoiceStatus,
} from "../client/src/components/billing-summary";

// Covers the "Amount due at this time" figure shown alongside the account credit
// balance (client/src/components/billing-summary.tsx). It is derived from the
// customer's unpaid + overdue invoices (remaining balance, falling back to total)
// rather than `payAll` — which is null unless 2+ invoices are owed — so it is
// correct even for a single outstanding invoice.

function inv(
  id: number,
  status: InvoiceStatus,
  total = "10.00",
  balance: string | null = null,
  currencyCode: string | null = "USD",
): BillingInvoice {
  return {
    id,
    invoiceNum: `INV-${id}`,
    date: null,
    dueDate: null,
    datePaid: null,
    total,
    balance,
    currencyCode,
    status,
    rawStatus: status,
    payUrl: null,
  };
}

function summary(
  invoices: BillingInvoice[],
  balanceCurrency: string | null = "USD",
): BillingSummary {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    client: { id: 1, name: "Test", status: "Active" },
    balance: { creditBalance: "0.00", currencyCode: balanceCurrency },
    invoices,
    products: [],
    portalUrl: null,
    payAll: null,
  };
}

test("amountDueAtThisTime sums unpaid + overdue balances (single invoice, where payAll is null)", () => {
  const d = summary([inv(1, "unpaid", "40.00")]);
  const due = amountDueAtThisTime(d);
  assert.equal(due.total, "40.00");
  assert.equal(due.count, 1);
  assert.equal(due.currencyCode, "USD");
});

test("amountDueAtThisTime prefers remaining balance over total and ignores settled invoices", () => {
  const d = summary([
    inv(1, "unpaid", "30.00", "20.00"),
    inv(2, "overdue", "15.00"),
    inv(3, "paid", "99.00"),
    inv(4, "cancelled", "50.00"),
    inv(5, "refunded", "10.00"),
  ]);
  const due = amountDueAtThisTime(d);
  assert.equal(due.total, "35.00");
  assert.equal(due.count, 2);
});

test("amountDueAtThisTime is 0.00 with nothing owed", () => {
  const d = summary([inv(1, "paid"), inv(2, "cancelled")]);
  const due = amountDueAtThisTime(d);
  assert.equal(due.total, "0.00");
  assert.equal(due.count, 0);
});

test("amountDueAtThisTime falls back to the account-balance currency when no outstanding invoice carries one", () => {
  const d = summary([inv(1, "unpaid", "12.00", null, null)], "EUR");
  const due = amountDueAtThisTime(d);
  assert.equal(due.total, "12.00");
  assert.equal(due.currencyCode, "EUR");
});

test("amountDueAtThisTime handles pre-formatted money strings ('$1,234.56 USD')", () => {
  const d = summary([inv(1, "overdue", "$1,234.56 USD")]);
  const due = amountDueAtThisTime(d);
  assert.equal(due.total, "1234.56");
});
