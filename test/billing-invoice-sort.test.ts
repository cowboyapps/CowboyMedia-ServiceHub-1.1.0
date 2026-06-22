import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sortInvoices,
  type BillingInvoice,
  type InvoiceStatus,
} from "../client/src/components/billing-summary";

// Covers the client-side invoice ordering toggle (Task #522):
// - "newest" returns the server's strict date-desc list untouched.
// - "outstanding" floats bills that need action to the top — overdue → unpaid →
//   rest — each group kept newest-first.

function inv(
  id: number,
  status: InvoiceStatus,
  date: string | null,
): BillingInvoice {
  return {
    id,
    invoiceNum: `INV-${id}`,
    date,
    dueDate: null,
    datePaid: null,
    total: "10.00",
    balance: null,
    currencyCode: "USD",
    status,
    rawStatus: status,
    payUrl: null,
  };
}

test("newest mode returns the list unchanged (same reference, server order)", () => {
  const list = [
    inv(3, "paid", "2026-03-01"),
    inv(2, "overdue", "2026-01-01"),
    inv(1, "unpaid", "2026-02-01"),
  ];
  const out = sortInvoices(list, "newest");
  assert.equal(out, list);
});

test("outstanding mode: overdue → unpaid → rest, each group newest-first", () => {
  const list = [
    inv(5, "paid", "2026-05-01"),
    inv(4, "unpaid", "2026-01-01"),
    inv(3, "overdue", "2026-02-01"),
    inv(2, "unpaid", "2026-04-01"),
    inv(1, "overdue", "2026-03-01"),
  ];
  const out = sortInvoices(list, "outstanding").map((i) => i.id);
  // overdue newest-first (1@Mar, 3@Feb), then unpaid newest-first (2@Apr, 4@Jan),
  // then the paid invoice.
  assert.deepEqual(out, [1, 3, 2, 4, 5]);
});

test("outstanding mode does not mutate the input array", () => {
  const list = [
    inv(1, "paid", "2026-01-01"),
    inv(2, "overdue", "2026-02-01"),
  ];
  const snapshot = list.map((i) => i.id);
  sortInvoices(list, "outstanding");
  assert.deepEqual(list.map((i) => i.id), snapshot);
});

test("outstanding mode tie-breaks equal dates by descending id", () => {
  const list = [
    inv(1, "unpaid", "2026-01-01"),
    inv(2, "unpaid", "2026-01-01"),
  ];
  const out = sortInvoices(list, "outstanding").map((i) => i.id);
  assert.deepEqual(out, [2, 1]);
});

test("outstanding mode handles null dates without throwing", () => {
  const list = [
    inv(1, "paid", null),
    inv(2, "overdue", null),
    inv(3, "unpaid", "2026-01-01"),
  ];
  const out = sortInvoices(list, "outstanding").map((i) => i.id);
  assert.deepEqual(out, [2, 3, 1]);
});
