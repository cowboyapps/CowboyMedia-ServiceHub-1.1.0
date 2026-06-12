import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWhmcsDate,
  deriveInvoiceStatus,
  buildInvoicePayUrl,
  buildInvoicePdfUrl,
  buildPortalUrl,
  parseInvoice,
  parseInvoiceDetail,
  parseInvoiceLineItem,
  parseProduct,
  buildBillingSummary,
  loadInvoiceDetail,
} from "./whmcs-billing";

const TODAY = "2026-06-11";

// ---------- normalizeWhmcsDate ----------
// WHMCS emits "0000-00-00" / "0000-00-00 00:00:00" for unset dates; those must
// collapse to null and the time portion must be dropped.

test("normalizeWhmcsDate: passes a clean date and strips the time portion", () => {
  assert.equal(normalizeWhmcsDate("2026-06-01"), "2026-06-01");
  assert.equal(normalizeWhmcsDate("2026-06-01 14:32:00"), "2026-06-01");
  assert.equal(normalizeWhmcsDate("  2026-06-01  "), "2026-06-01");
});

test("normalizeWhmcsDate: zero/empty/null become null", () => {
  assert.equal(normalizeWhmcsDate("0000-00-00"), null);
  assert.equal(normalizeWhmcsDate("0000-00-00 00:00:00"), null);
  assert.equal(normalizeWhmcsDate(""), null);
  assert.equal(normalizeWhmcsDate(null), null);
  assert.equal(normalizeWhmcsDate(undefined), null);
});

// ---------- deriveInvoiceStatus ----------
// "Overdue" is derived (Unpaid + past due), never stored.

test("deriveInvoiceStatus: unpaid past due is overdue, unpaid future stays unpaid", () => {
  assert.equal(deriveInvoiceStatus("Unpaid", "2026-06-01", TODAY), "overdue");
  assert.equal(deriveInvoiceStatus("Unpaid", "2026-12-01", TODAY), "unpaid");
  // Due exactly today is NOT overdue.
  assert.equal(deriveInvoiceStatus("Unpaid", TODAY, TODAY), "unpaid");
  // Unpaid with no due date cannot be overdue.
  assert.equal(deriveInvoiceStatus("Unpaid", null, TODAY), "unpaid");
});

test("deriveInvoiceStatus: maps the stored statuses (case-insensitive)", () => {
  assert.equal(deriveInvoiceStatus("Paid", null, TODAY), "paid");
  assert.equal(deriveInvoiceStatus("cancelled", null, TODAY), "cancelled");
  assert.equal(deriveInvoiceStatus("Refunded", null, TODAY), "refunded");
  assert.equal(deriveInvoiceStatus("Collections", null, TODAY), "collections");
  assert.equal(deriveInvoiceStatus("Draft", null, TODAY), "draft");
  assert.equal(deriveInvoiceStatus("Payment Pending", null, TODAY), "payment_pending");
  assert.equal(deriveInvoiceStatus("Something Else", null, TODAY), "other");
  assert.equal(deriveInvoiceStatus("", null, TODAY), "other");
});

// ---------- pay / portal URLs ----------

test("buildInvoicePayUrl / buildPortalUrl: build links, null without a base URL", () => {
  assert.equal(buildInvoicePayUrl("https://billing.example.com", 42), "https://billing.example.com/viewinvoice.php?id=42");
  assert.equal(buildInvoicePayUrl(null, 42), null);
  assert.equal(buildInvoicePayUrl("https://billing.example.com", 0), null);
  assert.equal(buildPortalUrl("https://billing.example.com"), "https://billing.example.com/clientarea.php");
  assert.equal(buildPortalUrl(null), null);
});

test("buildInvoicePdfUrl: builds the dl.php link, null without a base URL or id", () => {
  assert.equal(buildInvoicePdfUrl("https://billing.example.com", 42), "https://billing.example.com/dl.php?type=i&id=42");
  assert.equal(buildInvoicePdfUrl(null, 42), null);
  assert.equal(buildInvoicePdfUrl("https://billing.example.com", 0), null);
});

// ---------- parseInvoiceLineItem ----------

test("parseInvoiceLineItem: normalizes id, description, amount", () => {
  const item = parseInvoiceLineItem({ id: "9", description: "  Web Hosting (01/06/2026 - 30/06/2026)  ", amount: "39.95" });
  assert.equal(item.id, 9);
  assert.equal(item.description, "Web Hosting (01/06/2026 - 30/06/2026)");
  assert.equal(item.amount, "39.95");
});

// ---------- parseInvoiceDetail ----------

test("parseInvoiceDetail: extracts line items, totals breakdown, dates, status, URLs", () => {
  const detail = parseInvoiceDetail(
    {
      invoiceid: "100",
      invoicenum: "INV-100",
      userid: "5",
      date: "2026-05-01",
      duedate: "2026-06-01",
      datepaid: "0000-00-00 00:00:00",
      subtotal: "100.00",
      credit: "0.00",
      tax: "20.00",
      tax2: "0.00",
      taxrate: "20.00",
      taxrate2: "0.00",
      total: "120.00",
      balance: "120.00",
      currencycode: "USD",
      status: "Unpaid",
      paymentmethod: "stripe",
      paymentmethodname: "Credit Card",
      notes: "Thanks for your business",
      items: {
        item: [
          { id: 1, description: "Web Hosting", amount: "60.00" },
          { id: 2, description: "Domain", amount: "40.00" },
        ],
      },
    },
    "https://billing.example.com",
    TODAY,
  );
  assert.equal(detail.id, 100);
  assert.equal(detail.invoiceNum, "INV-100");
  assert.equal(detail.userId, 5);
  assert.equal(detail.date, "2026-05-01");
  assert.equal(detail.dueDate, "2026-06-01");
  assert.equal(detail.datePaid, null);
  assert.equal(detail.subtotal, "100.00");
  assert.equal(detail.tax, "20.00");
  assert.equal(detail.taxRate, "20.00");
  assert.equal(detail.total, "120.00");
  assert.equal(detail.balance, "120.00");
  assert.equal(detail.currencyCode, "USD");
  assert.equal(detail.status, "overdue");
  assert.equal(detail.rawStatus, "Unpaid");
  // paymentmethodname wins over the raw paymentmethod slug.
  assert.equal(detail.paymentMethod, "Credit Card");
  assert.equal(detail.notes, "Thanks for your business");
  assert.equal(detail.lineItems.length, 2);
  assert.equal(detail.lineItems[0].description, "Web Hosting");
  assert.equal(detail.payUrl, "https://billing.example.com/viewinvoice.php?id=100");
  assert.equal(detail.pdfUrl, "https://billing.example.com/dl.php?type=i&id=100");
});

test("parseInvoiceDetail: single-item collapses to array, absent money fields are null, paid date kept", () => {
  const detail = parseInvoiceDetail(
    {
      invoiceid: 7,
      userid: 5,
      total: "10.00",
      status: "Paid",
      datepaid: "2026-05-02",
      items: { item: { id: 1, description: "Setup", amount: "10.00" } },
    },
    null,
    TODAY,
  );
  assert.equal(detail.invoiceNum, "7");
  assert.equal(detail.status, "paid");
  assert.equal(detail.datePaid, "2026-05-02");
  assert.equal(detail.subtotal, null);
  assert.equal(detail.tax, null);
  assert.equal(detail.balance, null);
  assert.equal(detail.paymentMethod, null);
  assert.equal(detail.notes, null);
  assert.equal(detail.lineItems.length, 1);
  assert.equal(detail.lineItems[0].description, "Setup");
  assert.equal(detail.payUrl, null);
  assert.equal(detail.pdfUrl, null);
});

test("parseInvoiceDetail: no items field yields an empty line-item list", () => {
  const detail = parseInvoiceDetail({ invoiceid: 1, userid: 5, total: "0.00", status: "Draft" }, null, TODAY);
  assert.deepEqual(detail.lineItems, []);
  assert.equal(detail.status, "draft");
});

// ---------- parseInvoice ----------

test("parseInvoice: normalizes fields, derives overdue, builds pay URL", () => {
  const inv = parseInvoice(
    { id: "100", invoicenum: "INV-100", date: "2026-05-01", duedate: "2026-06-01", datepaid: "0000-00-00 00:00:00", total: "120.00", currencycode: "USD", status: "Unpaid" },
    "https://billing.example.com",
    TODAY,
  );
  assert.equal(inv.id, 100);
  assert.equal(inv.invoiceNum, "INV-100");
  assert.equal(inv.date, "2026-05-01");
  assert.equal(inv.dueDate, "2026-06-01");
  assert.equal(inv.datePaid, null);
  assert.equal(inv.total, "120.00");
  assert.equal(inv.currencyCode, "USD");
  assert.equal(inv.status, "overdue");
  assert.equal(inv.rawStatus, "Unpaid");
  assert.equal(inv.payUrl, "https://billing.example.com/viewinvoice.php?id=100");
  assert.equal(inv.balance, null);
});

test("parseInvoice: falls back invoiceNum to id, passes balance through", () => {
  const inv = parseInvoice({ id: 7, total: "10.00", balance: "4.00", status: "Paid", datepaid: "2026-05-02" }, null, TODAY);
  assert.equal(inv.invoiceNum, "7");
  assert.equal(inv.balance, "4.00");
  assert.equal(inv.status, "paid");
  assert.equal(inv.datePaid, "2026-05-02");
  assert.equal(inv.payUrl, null);
});

// ---------- parseProduct ----------

test("parseProduct: keeps both id and pid and normalizes the next due date", () => {
  const p = parseProduct({ id: "55", pid: "12", name: "Web Hosting", domain: "example.com", status: "Active", nextduedate: "2026-07-01", billingcycle: "Monthly", recurringamount: "9.99" });
  assert.equal(p.id, 55);
  assert.equal(p.pid, 12);
  assert.equal(p.name, "Web Hosting");
  assert.equal(p.domain, "example.com");
  assert.equal(p.status, "Active");
  assert.equal(p.nextDueDate, "2026-07-01");
  assert.equal(p.billingCycle, "Monthly");
  assert.equal(p.amount, "9.99");
});

test("parseProduct: name fallbacks and zero next due date", () => {
  assert.equal(parseProduct({ id: 1, translated_name: "Dominio" }).name, "Dominio");
  assert.equal(parseProduct({ id: 1, groupname: "Hosting" }).name, "Hosting");
  assert.equal(parseProduct({ id: 1 }).name, "Service");
  assert.equal(parseProduct({ id: 1, nextduedate: "0000-00-00" }).nextDueDate, null);
});

// ---------- buildBillingSummary ----------

const okBilling = (data: any) => ({ ok: true, data });
const fail = () => ({ ok: false, error: "boom", reason: "network" as const });

test("buildBillingSummary: assembles client, balance, invoices, products", () => {
  const summary = buildBillingSummary(
    "https://billing.example.com",
    okBilling({
      client: { id: 5, firstname: "Ada", lastname: "Lovelace", companyname: "Analytical", status: "Active", currency_code: "GBP" },
      stats: { creditbalance: "£5.00 GBP" },
    }),
    okBilling({ invoices: { invoice: [{ id: 1, total: "10.00", status: "Unpaid", duedate: "2026-01-01" }] } }),
    okBilling({ products: { product: { id: 9, pid: 3, name: "VPS", status: "Active", nextduedate: "2026-08-01", recurringamount: "20.00" } } }),
    TODAY,
  );
  assert.equal(summary.unreachable, false);
  assert.equal(summary.client?.id, 5);
  // Company name wins for the display name.
  assert.equal(summary.client?.name, "Analytical");
  assert.equal(summary.client?.status, "Active");
  assert.equal(summary.balance?.creditBalance, "£5.00 GBP");
  assert.equal(summary.balance?.currencyCode, "GBP");
  assert.equal(summary.invoices.length, 1);
  assert.equal(summary.invoices[0].status, "overdue");
  // Single-object product collapses to a one-element array.
  assert.equal(summary.products.length, 1);
  assert.equal(summary.products[0].pid, 3);
  assert.equal(summary.portalUrl, "https://billing.example.com/clientarea.php");
});

test("buildBillingSummary: full outage -> unreachable, empty, null client/balance", () => {
  const summary = buildBillingSummary("https://billing.example.com", fail(), fail(), fail(), TODAY);
  assert.equal(summary.unreachable, true);
  assert.equal(summary.client, null);
  assert.equal(summary.balance, null);
  assert.deepEqual(summary.invoices, []);
  assert.deepEqual(summary.products, []);
  // Portal URL still derives from the base URL even on outage.
  assert.equal(summary.portalUrl, "https://billing.example.com/clientarea.php");
});

test("buildBillingSummary: partial failure degrades only the failed section", () => {
  const summary = buildBillingSummary(
    "https://billing.example.com",
    okBilling({ client: { id: 5, companyname: "Acme", status: "Active" }, stats: {} }),
    fail(), // invoices unreachable
    okBilling({ products: { product: [] } }),
    TODAY,
  );
  assert.equal(summary.unreachable, false);
  assert.equal(summary.client?.name, "Acme");
  assert.deepEqual(summary.invoices, []);
  assert.deepEqual(summary.products, []);
  // No stats.creditbalance and no credit field -> null.
  assert.equal(summary.balance?.creditBalance, null);
});

test("buildBillingSummary: pins overdue then unpaid to top, rest by date desc", () => {
  const summary = buildBillingSummary(
    "https://billing.example.com",
    fail(), // client details unreachable, but invoices/products ok -> not a full outage
    okBilling({
      invoices: {
        invoice: [
          { id: 1, date: "2026-01-01", total: "10.00", status: "Paid", datepaid: "2026-01-05" },
          { id: 2, date: "2026-03-01", duedate: "2026-12-01", total: "20.00", status: "Unpaid" }, // future due -> unpaid
          { id: 3, date: "2026-02-01", duedate: "2026-01-01", total: "30.00", status: "Unpaid" }, // past due -> overdue
          { id: 4, date: "2026-05-01", total: "40.00", status: "Paid", datepaid: "2026-05-02" },
        ],
      },
    }),
    okBilling({ products: {} }),
    TODAY,
  );
  // overdue (#3) first, then unpaid (#2), then the two paid most-recent-first (#4 before #1).
  assert.deepEqual(summary.invoices.map((i) => i.id), [3, 2, 4, 1]);
  assert.equal(summary.invoices[0].status, "overdue");
  assert.equal(summary.invoices[1].status, "unpaid");
});

test("buildBillingSummary: credit fallback when stats.creditbalance absent", () => {
  const summary = buildBillingSummary(
    null,
    okBilling({ client: { id: 5, status: "Active", credit: "12.50", currencycode: "USD" } }),
    okBilling({ invoices: {} }),
    okBilling({ products: {} }),
    TODAY,
  );
  assert.equal(summary.balance?.creditBalance, "12.50");
  assert.equal(summary.balance?.currencyCode, "USD");
  assert.equal(summary.client?.name, "Client #5");
  assert.equal(summary.portalUrl, null);
});

// ---------- loadInvoiceDetail (ownership enforcement, Task #372) ----------
// The single-invoice route derives the WHMCS client id from the session and
// must reject any invoice owned by another client — collapsed to a clean
// not-found so an attacker can't enumerate other clients' invoice ids. These
// tests stub the WHMCS getInvoice fetcher (mirroring the notifier/loader DI
// tests) and assert the ownership branch never leaks across clients.

const okInvoice = (data: any) => async () => ({ ok: true, data });

test("loadInvoiceDetail: matching owner returns the parsed invoice", async () => {
  const fetch = okInvoice({ invoiceid: 100, userid: 5, total: "120.00", status: "Unpaid", duedate: "2026-12-01" });
  const result = await loadInvoiceDetail(100, 5, "https://billing.example.com", fetch);
  assert.equal(result.notFound, false);
  assert.equal(result.unreachable, false);
  assert.equal(result.invoice?.id, 100);
  assert.equal(result.invoice?.userId, 5);
  assert.equal(result.invoice?.payUrl, "https://billing.example.com/viewinvoice.php?id=100");
});

test("loadInvoiceDetail: mismatched owner is collapsed to not-found (no leak, no enumeration oracle)", async () => {
  const fetch = okInvoice({ invoiceid: 100, userid: 999, total: "120.00", status: "Unpaid" });
  const result = await loadInvoiceDetail(100, 5, "https://billing.example.com", fetch);
  assert.equal(result.notFound, true);
  assert.equal(result.unreachable, false);
  assert.equal(result.invoice, null);
});

test("loadInvoiceDetail: a zero/absent owning userid is rejected, not silently matched", async () => {
  const fetch = okInvoice({ invoiceid: 100, total: "120.00", status: "Unpaid" });
  const result = await loadInvoiceDetail(100, 5, "https://billing.example.com", fetch);
  assert.equal(result.notFound, true);
  assert.equal(result.invoice, null);
});

test("loadInvoiceDetail: WHMCS 'not found' is a clean not-found, not an outage", async () => {
  const fetch = async () => ({ ok: false, error: "Invoice ID Not Found", reason: "whmcs_error" as const });
  const result = await loadInvoiceDetail(100, 5, "https://billing.example.com", fetch);
  assert.equal(result.notFound, true);
  assert.equal(result.unreachable, false);
  assert.equal(result.invoice, null);
});

test("loadInvoiceDetail: any other failure surfaces as unreachable, not not-found", async () => {
  const fetch = async () => ({ ok: false, error: "boom", reason: "network" as const });
  const result = await loadInvoiceDetail(100, 5, "https://billing.example.com", fetch);
  assert.equal(result.unreachable, true);
  assert.equal(result.notFound, false);
  assert.equal(result.invoice, null);
});
