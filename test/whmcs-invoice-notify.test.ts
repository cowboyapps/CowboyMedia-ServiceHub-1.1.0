import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeInvoiceStage,
  selectInvoicesToNotify,
  stageRank,
  addDaysToDateString,
  daysUntilDue,
  invoiceAmountLabel,
  invoiceLabel,
  invoiceDuePhrase,
  invoiceNotifTitle,
  invoiceNotifBody,
  type InvoiceNotifyCandidate,
  type InvoiceStageMap,
} from "../shared/whmcs-invoice-notify";

const TODAY = "2026-06-11";
const DUE_SOON_DAYS = 3;

const inv = (over: Partial<InvoiceNotifyCandidate>): InvoiceNotifyCandidate => ({
  id: 1,
  status: "unpaid",
  dueDate: "2026-06-13",
  ...over,
});

test("addDaysToDateString: UTC day granularity, handles month rollover", () => {
  assert.equal(addDaysToDateString("2026-06-11", 3), "2026-06-14");
  assert.equal(addDaysToDateString("2026-06-30", 1), "2026-07-01");
  assert.equal(addDaysToDateString("2026-12-31", 1), "2027-01-01");
  assert.equal(addDaysToDateString("2026-06-11", 0), "2026-06-11");
});

test("stageRank: none < due_soon < overdue", () => {
  assert.ok(stageRank(null) < stageRank("due_soon"));
  assert.ok(stageRank("due_soon") < stageRank("overdue"));
});

test("computeInvoiceStage: overdue when due date strictly before today", () => {
  assert.equal(computeInvoiceStage(inv({ dueDate: "2026-06-10" }), TODAY, DUE_SOON_DAYS), "overdue");
  // A WHMCS-derived "overdue" status also resolves overdue.
  assert.equal(computeInvoiceStage(inv({ status: "overdue", dueDate: "2026-05-01" }), TODAY, DUE_SOON_DAYS), "overdue");
});

test("computeInvoiceStage: due_soon includes today and the window end (inclusive)", () => {
  assert.equal(computeInvoiceStage(inv({ dueDate: TODAY }), TODAY, DUE_SOON_DAYS), "due_soon");
  assert.equal(computeInvoiceStage(inv({ dueDate: "2026-06-14" }), TODAY, DUE_SOON_DAYS), "due_soon"); // today+3
});

test("computeInvoiceStage: null when due date is beyond the window", () => {
  assert.equal(computeInvoiceStage(inv({ dueDate: "2026-06-15" }), TODAY, DUE_SOON_DAYS), null); // today+4
});

test("computeInvoiceStage: null for non-payable statuses", () => {
  for (const status of ["paid", "cancelled", "refunded", "draft", "payment_pending", "collections", "other"]) {
    assert.equal(computeInvoiceStage(inv({ status, dueDate: "2026-06-10" }), TODAY, DUE_SOON_DAYS), null, status);
  }
});

test("computeInvoiceStage: null when there is no due date", () => {
  assert.equal(computeInvoiceStage(inv({ dueDate: null }), TODAY, DUE_SOON_DAYS), null);
});

test("selectInvoicesToNotify: never-notified due_soon and overdue both fire", () => {
  const invoices = [
    inv({ id: 1, dueDate: "2026-06-13" }), // due_soon
    inv({ id: 2, dueDate: "2026-06-01" }), // overdue
    inv({ id: 3, status: "paid", dueDate: "2026-06-01" }), // dropped
    inv({ id: 4, dueDate: "2026-07-01" }), // beyond window, dropped
  ];
  const out = selectInvoicesToNotify(invoices, {}, TODAY, DUE_SOON_DAYS);
  assert.deepEqual(
    out.map((o) => [o.invoice.id, o.stage]),
    [
      [1, "due_soon"],
      [2, "overdue"],
    ],
  );
});

test("selectInvoicesToNotify: notify at most once per stage (dedup)", () => {
  const invoices = [inv({ id: 7, dueDate: "2026-06-13" })]; // due_soon
  const notified: InvoiceStageMap = { "7": "due_soon" };
  assert.deepEqual(selectInvoicesToNotify(invoices, notified, TODAY, DUE_SOON_DAYS), []);
});

test("selectInvoicesToNotify: escalates due_soon -> overdue on a later pass", () => {
  const invoices = [inv({ id: 7, dueDate: "2026-06-10" })]; // now overdue
  const notified: InvoiceStageMap = { "7": "due_soon" };
  const out = selectInvoicesToNotify(invoices, notified, TODAY, DUE_SOON_DAYS);
  assert.deepEqual(out.map((o) => [o.invoice.id, o.stage]), [[7, "overdue"]]);
});

test("selectInvoicesToNotify: a missed due_soon window still fires overdue once", () => {
  // Poll skipped the entire due-soon window; invoice is already overdue and was
  // never notified -> overdue fires (rank 2 > 0).
  const invoices = [inv({ id: 9, dueDate: "2026-06-01" })];
  const out = selectInvoicesToNotify(invoices, {}, TODAY, DUE_SOON_DAYS);
  assert.deepEqual(out.map((o) => [o.invoice.id, o.stage]), [[9, "overdue"]]);
});

test("selectInvoicesToNotify: already-overdue marker never re-fires", () => {
  const invoices = [inv({ id: 9, dueDate: "2026-06-01" })];
  const notified: InvoiceStageMap = { "9": "overdue" };
  assert.deepEqual(selectInvoicesToNotify(invoices, notified, TODAY, DUE_SOON_DAYS), []);
});

test("daysUntilDue: whole-day UTC diff", () => {
  assert.equal(daysUntilDue(TODAY, "2026-06-14"), 3);
  assert.equal(daysUntilDue(TODAY, TODAY), 0);
  assert.equal(daysUntilDue(TODAY, "2026-06-10"), -1);
});

test("invoiceAmountLabel: prefers balance, appends currency, handles missing", () => {
  assert.equal(invoiceAmountLabel(inv({ balance: "10.00", total: "20.00", currencyCode: "USD" })), "10.00 USD");
  assert.equal(invoiceAmountLabel(inv({ balance: null, total: "20.00", currencyCode: "USD" })), "20.00 USD");
  assert.equal(invoiceAmountLabel(inv({ balance: "5.00", currencyCode: null })), "5.00");
  assert.equal(invoiceAmountLabel(inv({ balance: null, total: undefined, currencyCode: "USD" })), "USD");
});

test("invoiceLabel: adds leading # and falls back to id", () => {
  assert.equal(invoiceLabel(inv({ id: 7, invoiceNum: "1234" })), "#1234");
  assert.equal(invoiceLabel(inv({ id: 7, invoiceNum: "#1234" })), "#1234");
  assert.equal(invoiceLabel(inv({ id: 7, invoiceNum: undefined })), "#7");
});

test("invoiceDuePhrase: today / tomorrow / N days / overdue", () => {
  assert.equal(invoiceDuePhrase("due_soon", TODAY, TODAY), "is due today");
  assert.equal(invoiceDuePhrase("due_soon", TODAY, "2026-06-12"), "is due tomorrow");
  assert.equal(invoiceDuePhrase("due_soon", TODAY, "2026-06-14"), "is due in 3 days");
  assert.equal(invoiceDuePhrase("overdue", TODAY, "2026-06-01"), "is overdue");
});

test("invoiceNotifTitle + invoiceNotifBody: customer-friendly copy", () => {
  assert.equal(invoiceNotifTitle("due_soon"), "Invoice due soon");
  assert.equal(invoiceNotifTitle("overdue"), "Invoice overdue");
  assert.equal(
    invoiceNotifBody(inv({ id: 1, invoiceNum: "1234", balance: "10.00", currencyCode: "USD", dueDate: "2026-06-14" }), "due_soon", TODAY),
    "Invoice #1234 (10.00 USD) is due in 3 days.",
  );
  assert.equal(
    invoiceNotifBody(inv({ id: 1, invoiceNum: "1234", balance: "10.00", currencyCode: "USD", dueDate: "2026-06-01" }), "overdue", TODAY),
    "Invoice #1234 (10.00 USD) is overdue.",
  );
});
