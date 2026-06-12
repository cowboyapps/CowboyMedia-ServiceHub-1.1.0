import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWhmcsDate,
  deriveInvoiceStatus,
  buildInvoicePayUrl,
  buildInvoicePdfUrl,
  buildPortalUrl,
  buildMassPayUrl,
  buildPayAllOutstanding,
  parseInvoice,
  parseInvoiceDetail,
  parseInvoiceLineItem,
  parseProduct,
  stripProductCredentials,
  selectActiveServices,
  buildBillingSummary,
  loadInvoiceDetail,
  parseMoneyNumber,
  monthlyizeAmount,
  buildBillingDashboard,
  parseTransaction,
  buildTransactionHistory,
  loadTransactionHistory,
  loadTransactionHistoryWithServices,
  resetTransactionHistoryCache,
  correlateTransactionService,
  applyTransactionServiceHints,
  type BillingSummaryData,
  type ParsedInvoiceLineItem,
  type ParsedTransaction,
  type ParsedInvoice,
  type ParsedProduct,
  type DashboardCustomerEntry,
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

test("buildMassPayUrl: builds a comma-separated mass-pay link, drops invalid ids", () => {
  assert.equal(
    buildMassPayUrl("https://billing.example.com", [1, 2, 3]),
    "https://billing.example.com/viewinvoice.php?id=1,2,3",
  );
  // Zero / negative / NaN ids are dropped before joining.
  assert.equal(
    buildMassPayUrl("https://billing.example.com", [0, 5, -1, NaN, 7]),
    "https://billing.example.com/viewinvoice.php?id=5,7",
  );
  assert.equal(buildMassPayUrl(null, [1, 2]), null);
  assert.equal(buildMassPayUrl("https://billing.example.com", []), null);
  assert.equal(buildMassPayUrl("https://billing.example.com", [0]), null);
});

// ---------- parseInvoiceLineItem ----------

test("parseInvoiceLineItem: normalizes id, description, amount", () => {
  const item = parseInvoiceLineItem({ id: "9", description: "  Web Hosting (01/06/2026 - 30/06/2026)  ", amount: "39.95" });
  assert.equal(item.id, 9);
  assert.equal(item.description, "Web Hosting (01/06/2026 - 30/06/2026)");
  assert.equal(item.amount, "39.95");
  // No type/relid -> no linked service.
  assert.equal(item.type, "");
  assert.equal(item.serviceId, null);
  assert.equal(item.serviceUrl, null);
});

// ---------- parseInvoiceLineItem: related service mapping (Task #414) ----------
// WHMCS puts the renewed service id in `relid` on a "Hosting" line item; capture
// it + the outbound product-detail deep link so customers can jump from a payment
// to the product it was for. Only "Hosting" lines map — domains / ad-hoc items don't.

test("parseInvoiceLineItem: a Hosting line captures relid as serviceId + builds the service URL", () => {
  const item = parseInvoiceLineItem(
    { id: 1, type: "Hosting", relid: "55", description: "VPS Renewal", amount: "20.00" },
    "https://billing.example.com",
  );
  assert.equal(item.type, "Hosting");
  assert.equal(item.serviceId, 55);
  assert.equal(item.serviceUrl, "https://billing.example.com/clientarea.php?action=productdetails&id=55");
});

test("parseInvoiceLineItem: Hosting type is case-insensitive, serviceUrl null without a base URL", () => {
  const item = parseInvoiceLineItem({ id: 2, type: "hosting", relid: 7, description: "Hosting", amount: "5.00" });
  assert.equal(item.serviceId, 7);
  // No base URL -> no deep link, but the id is still captured.
  assert.equal(item.serviceUrl, null);
});

test("parseInvoiceLineItem: non-Hosting lines never link a service, even with a relid", () => {
  const domain = parseInvoiceLineItem(
    { id: 3, type: "Domain", relid: "88", description: "example.com", amount: "12.00" },
    "https://billing.example.com",
  );
  assert.equal(domain.serviceId, null);
  assert.equal(domain.serviceUrl, null);
  const credit = parseInvoiceLineItem(
    { id: 4, type: "AddFunds", relid: "99", description: "Add Funds", amount: "50.00" },
    "https://billing.example.com",
  );
  assert.equal(credit.serviceId, null);
  assert.equal(credit.serviceUrl, null);
});

test("parseInvoiceLineItem: Hosting with a zero/absent/non-numeric relid stays unlinked", () => {
  const base = "https://billing.example.com";
  assert.equal(parseInvoiceLineItem({ id: 1, type: "Hosting", relid: 0 }, base).serviceId, null);
  assert.equal(parseInvoiceLineItem({ id: 2, type: "Hosting" }, base).serviceId, null);
  assert.equal(parseInvoiceLineItem({ id: 3, type: "Hosting", relid: "abc" }, base).serviceId, null);
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

test("parseInvoiceDetail: threads the base URL into line items so a Hosting line links its service", () => {
  const detail = parseInvoiceDetail(
    {
      invoiceid: 200,
      userid: 5,
      total: "20.00",
      status: "Paid",
      items: {
        item: [
          { id: 1, type: "Hosting", relid: 55, description: "VPS Renewal", amount: "20.00" },
          { id: 2, type: "Domain", relid: 88, description: "example.com", amount: "12.00" },
        ],
      },
    },
    "https://billing.example.com",
    TODAY,
  );
  assert.equal(detail.lineItems[0].serviceId, 55);
  assert.equal(detail.lineItems[0].serviceUrl, "https://billing.example.com/clientarea.php?action=productdetails&id=55");
  // The domain line stays unlinked.
  assert.equal(detail.lineItems[1].serviceId, null);
  assert.equal(detail.lineItems[1].serviceUrl, null);
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
  const p = parseProduct({ id: "55", pid: "12", name: "Web Hosting", domain: "example.com", status: "Active", nextduedate: "2026-07-01", billingcycle: "Monthly", recurringamount: "9.99", username: "user55", password: "s3cr3t!" });
  assert.equal(p.id, 55);
  assert.equal(p.pid, 12);
  assert.equal(p.name, "Web Hosting");
  assert.equal(p.domain, "example.com");
  assert.equal(p.status, "Active");
  assert.equal(p.nextDueDate, "2026-07-01");
  assert.equal(p.billingCycle, "Monthly");
  assert.equal(p.amount, "9.99");
  assert.equal(p.username, "user55");
  assert.equal(p.password, "s3cr3t!");
});

test("parseProduct: name fallbacks and zero next due date", () => {
  assert.equal(parseProduct({ id: 1, translated_name: "Dominio" }).name, "Dominio");
  assert.equal(parseProduct({ id: 1, groupname: "Hosting" }).name, "Hosting");
  assert.equal(parseProduct({ id: 1 }).name, "Service");
  assert.equal(parseProduct({ id: 1, nextduedate: "0000-00-00" }).nextDueDate, null);
});

test("parseProduct: username trims but password is preserved verbatim, missing -> empty", () => {
  const p = parseProduct({ id: 1, username: "  user  ", password: "  pa ss  " });
  assert.equal(p.username, "user");
  // Passwords can legitimately contain leading/trailing spaces — never trim them.
  assert.equal(p.password, "  pa ss  ");
  const bare = parseProduct({ id: 2 });
  assert.equal(bare.username, "");
  assert.equal(bare.password, "");
});

test("parseProduct: parses ONLY username/password access fields — no IP/host/DNS/custom leak", () => {
  const p = parseProduct({
    id: 1,
    username: "user",
    password: "pw",
    dedicatedip: "1.2.3.4",
    serverhostname: "host.example.com",
    ns1: "ns1.example.com",
    customfields: [{ name: "DNS", value: "dns.example.com" }],
    configoptions: [{ option: "RAM", value: "8GB" }],
  });
  const keys = Object.keys(p).sort();
  assert.deepEqual(keys, ["amount", "billingCycle", "domain", "id", "name", "nextDueDate", "password", "pid", "status", "username"]);
  // None of the extra access fields leaked onto the parsed shape.
  assert.equal((p as any).dedicatedip, undefined);
  assert.equal((p as any).serverhostname, undefined);
  assert.equal((p as any).ns1, undefined);
  assert.equal((p as any).customfields, undefined);
  assert.equal((p as any).configoptions, undefined);
});

// ---------- stripProductCredentials ----------

test("stripProductCredentials: removes username/password, keeps everything else", () => {
  const p = parseProduct({ id: 9, pid: 3, name: "VPS", status: "Active", username: "u", password: "p" });
  const stripped = stripProductCredentials(p);
  assert.equal((stripped as any).username, undefined);
  assert.equal((stripped as any).password, undefined);
  assert.equal(stripped.id, 9);
  assert.equal(stripped.pid, 3);
  assert.equal(stripped.name, "VPS");
  assert.equal(stripped.status, "Active");
});

// ---------- selectActiveServices ----------

test("selectActiveServices: keeps ONLY active products and projects to the access view", () => {
  const services = selectActiveServices([
    parseProduct({ id: 1, name: "Live VPS", status: "Active", billingcycle: "Monthly", recurringamount: "20.00", nextduedate: "2026-08-01", username: "u1", password: "p1" }),
    parseProduct({ id: 2, name: "Suspended", status: "Suspended", username: "u2", password: "p2" }),
    parseProduct({ id: 3, name: "Terminated", status: "Terminated", username: "u3", password: "p3" }),
    parseProduct({ id: 4, name: "Cancelled", status: "Cancelled", username: "u4", password: "p4" }),
    parseProduct({ id: 5, name: "Pending", status: "Pending", username: "u5", password: "p5" }),
    parseProduct({ id: 6, name: "Fraud", status: "Fraud", username: "u6", password: "p6" }),
  ]);
  assert.equal(services.length, 1);
  const s = services[0];
  assert.equal(s.id, 1);
  assert.equal(s.name, "Live VPS");
  assert.equal(s.status, "Active");
  assert.equal(s.billingCycle, "Monthly");
  assert.equal(s.amount, "20.00");
  assert.equal(s.nextDueDate, "2026-08-01");
  assert.equal(s.username, "u1");
  assert.equal(s.password, "p1");
  // Only the access view fields — no pid/domain carried through.
  assert.deepEqual(Object.keys(s).sort(), ["amount", "billingCycle", "id", "name", "nextDueDate", "password", "status", "username"]);
});

test("selectActiveServices: 'active' is case-insensitive, empty list when none active", () => {
  assert.equal(selectActiveServices([parseProduct({ id: 1, status: "ACTIVE", username: "u", password: "p" })]).length, 1);
  assert.deepEqual(selectActiveServices([parseProduct({ id: 1, status: "Suspended" })]), []);
  assert.deepEqual(selectActiveServices([]), []);
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
  // One outstanding invoice -> no "pay all" action.
  assert.equal(summary.payAll, null);
});

test("buildBillingSummary: products NEVER carry username/password (admin-shared summary stays credential-free)", () => {
  const summary = buildBillingSummary(
    "https://billing.example.com",
    fail(),
    okBilling({ invoices: {} }),
    okBilling({ products: { product: { id: 9, pid: 3, name: "VPS", status: "Active", username: "secretuser", password: "secretpw" } } }),
    TODAY,
  );
  assert.equal(summary.products.length, 1);
  assert.equal((summary.products[0] as any).username, undefined);
  assert.equal((summary.products[0] as any).password, undefined);
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
  // Two outstanding (overdue #3 + unpaid #2) -> "pay all" action present.
  assert.notEqual(summary.payAll, null);
  assert.equal(summary.payAll!.count, 2);
  assert.equal(summary.payAll!.url, "https://billing.example.com/viewinvoice.php?id=3,2");
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

// ---------- parseMoneyNumber ----------
// WHMCS money strings carry symbols, codes and thousands separators; a bad
// field must never NaN a running total.

test("parseMoneyNumber: strips symbols and separators", () => {
  assert.equal(parseMoneyNumber("$1,234.56"), 1234.56);
  assert.equal(parseMoneyNumber("1234.56 USD"), 1234.56);
  assert.equal(parseMoneyNumber("  10.00  "), 10);
  assert.equal(parseMoneyNumber("-5.50"), -5.5);
});

test("parseMoneyNumber: absent/unparseable becomes 0", () => {
  assert.equal(parseMoneyNumber(null), 0);
  assert.equal(parseMoneyNumber(undefined), 0);
  assert.equal(parseMoneyNumber(""), 0);
  assert.equal(parseMoneyNumber("abc"), 0);
});

// ---------- monthlyizeAmount ----------
// Only known recurring cycles contribute to MRR; one-time/unknown -> 0.

test("monthlyizeAmount: normalizes each recurring cycle to per-month", () => {
  assert.equal(monthlyizeAmount("30.00", "Monthly"), 30);
  assert.equal(monthlyizeAmount("30.00", "Quarterly"), 10);
  assert.equal(monthlyizeAmount("60.00", "Semi-Annually"), 10);
  assert.equal(monthlyizeAmount("120.00", "Annually"), 10);
  assert.equal(monthlyizeAmount("120.00", "yearly"), 10);
  assert.equal(monthlyizeAmount("240.00", "Biennially"), 10);
  assert.equal(monthlyizeAmount("360.00", "Triennially"), 10);
});

test("monthlyizeAmount: one-time/unknown/zero contribute nothing", () => {
  assert.equal(monthlyizeAmount("100.00", "One Time"), 0);
  assert.equal(monthlyizeAmount("100.00", ""), 0);
  assert.equal(monthlyizeAmount("0.00", "Monthly"), 0);
  assert.equal(monthlyizeAmount(null, "Monthly"), 0);
});

// ---------- buildBillingDashboard ----------

function inv(over: Partial<ParsedInvoice>): ParsedInvoice {
  return {
    id: 1,
    invoiceNum: "1",
    date: "2026-01-01",
    dueDate: "2026-01-01",
    datePaid: null,
    total: "0.00",
    balance: null,
    currencyCode: "USD",
    status: "paid",
    rawStatus: "Paid",
    payUrl: null,
    ...over,
  };
}

function prod(over: Partial<ParsedProduct>): ParsedProduct {
  return {
    id: 1,
    pid: 1,
    name: "Service",
    domain: "",
    status: "Active",
    nextDueDate: null,
    billingCycle: "Monthly",
    amount: "0.00",
    username: "",
    password: "",
    ...over,
  };
}

function summary(over: Partial<BillingSummaryData>): BillingSummaryData {
  return {
    client: { id: 1, name: "Client", status: "Active" },
    balance: { creditBalance: null, currencyCode: "USD" },
    invoices: [],
    products: [],
    portalUrl: null,
    payAll: null,
    unreachable: false,
    ...over,
  };
}

function entry(userId: string, fallbackName: string, s: BillingSummaryData | null): DashboardCustomerEntry {
  return { userId, fallbackName, summary: s };
}

// ---------- buildPayAllOutstanding ----------
// The combined "pay all outstanding" action only appears with 2+ owed invoices,
// sums their balances (falling back to total), and deep-links the WHMCS mass-pay.

test("buildPayAllOutstanding: sums unpaid + overdue, builds mass-pay link, ignores paid", () => {
  const payAll = buildPayAllOutstanding(
    [
      inv({ id: 1, status: "overdue", balance: "30.00", currencyCode: "USD" }),
      inv({ id: 2, status: "unpaid", balance: "20.00", currencyCode: "USD" }),
      inv({ id: 3, status: "paid", balance: "0.00", currencyCode: "USD" }),
      inv({ id: 4, status: "cancelled", balance: "99.00", currencyCode: "USD" }),
    ],
    "https://billing.example.com",
  );
  assert.notEqual(payAll, null);
  assert.equal(payAll!.count, 2);
  assert.equal(payAll!.total, "50.00");
  assert.equal(payAll!.currencyCode, "USD");
  // Only the two outstanding ids (overdue + unpaid) go in the mass-pay link.
  assert.equal(payAll!.url, "https://billing.example.com/viewinvoice.php?id=1,2");
});

test("buildPayAllOutstanding: falls back to total when an outstanding balance is null", () => {
  const payAll = buildPayAllOutstanding(
    [
      inv({ id: 1, status: "unpaid", balance: null, total: "42.00", currencyCode: "GBP" }),
      inv({ id: 2, status: "overdue", balance: "8.00", total: "8.00", currencyCode: "GBP" }),
    ],
    "https://billing.example.com",
  );
  assert.equal(payAll!.total, "50.00");
  assert.equal(payAll!.currencyCode, "GBP");
});

test("buildPayAllOutstanding: hidden for zero or one outstanding invoice", () => {
  // Zero outstanding (only paid).
  assert.equal(
    buildPayAllOutstanding([inv({ id: 1, status: "paid", balance: "0.00" })], "https://billing.example.com"),
    null,
  );
  // Exactly one outstanding -> already covered by its own pay link.
  assert.equal(
    buildPayAllOutstanding(
      [inv({ id: 1, status: "unpaid", balance: "10.00" }), inv({ id: 2, status: "paid", balance: "0.00" })],
      "https://billing.example.com",
    ),
    null,
  );
  // No invoices at all.
  assert.equal(buildPayAllOutstanding([], "https://billing.example.com"), null);
});

test("buildPayAllOutstanding: still totals when there's no base URL, url is null", () => {
  const payAll = buildPayAllOutstanding(
    [
      inv({ id: 1, status: "overdue", balance: "15.50", currencyCode: "EUR" }),
      inv({ id: 2, status: "unpaid", balance: "4.50", currencyCode: "EUR" }),
    ],
    null,
  );
  assert.equal(payAll!.count, 2);
  assert.equal(payAll!.total, "20.00");
  assert.equal(payAll!.currencyCode, "EUR");
  assert.equal(payAll!.url, null);
});

test("buildBillingDashboard: rolls up outstanding, overdue, services and MRR", () => {
  const dash = buildBillingDashboard(
    [
      entry("u1", "Alice", summary({
        client: { id: 10, name: "Acme", status: "Active" },
        invoices: [
          inv({ id: 1, status: "overdue", balance: "30.00" }),
          inv({ id: 2, status: "unpaid", balance: "20.00" }),
          inv({ id: 3, status: "paid", balance: "0.00" }),
        ],
        products: [
          prod({ status: "Active", billingCycle: "Monthly", amount: "10.00" }),
          prod({ status: "Active", billingCycle: "Annually", amount: "120.00" }),
          prod({ status: "Suspended", billingCycle: "Monthly", amount: "5.00" }),
        ],
      })),
      entry("u2", "Bob", summary({
        client: { id: 11, name: "Beta", status: "Active" },
        invoices: [inv({ id: 4, status: "unpaid", balance: "5.00" })],
        products: [prod({ status: "Active", billingCycle: "Monthly", amount: "7.00" })],
      })),
    ],
    "2026-06-11T00:00:00.000Z",
  );

  assert.equal(dash.summary.linkedCustomers, 2);
  assert.equal(dash.summary.customersLoaded, 2);
  assert.equal(dash.summary.customersFailed, 0);
  assert.equal(dash.summary.totalOutstanding, 55);
  assert.equal(dash.summary.overdueAmount, 30);
  assert.equal(dash.summary.overdueInvoiceCount, 1);
  assert.equal(dash.summary.unpaidInvoiceCount, 3);
  assert.equal(dash.summary.activeServices, 3);
  assert.equal(dash.summary.suspendedServices, 1);
  // 10 (monthly) + 120/12 (annual) + 7 (monthly) = 27
  assert.equal(dash.summary.estimatedMrr, 27);
  assert.equal(dash.partial, false);
  assert.equal(dash.unreachable, false);
  // Highest outstanding first: Acme (50) before Beta (5).
  assert.deepEqual(dash.customers.map((c) => c.userId), ["u1", "u2"]);
  assert.equal(dash.customers[0].outstanding, 50);
  assert.equal(dash.customers[0].overdue, 30);
});

test("buildBillingDashboard: balance falls back to total when invoice balance null", () => {
  const dash = buildBillingDashboard(
    [entry("u1", "Alice", summary({
      invoices: [inv({ id: 1, status: "unpaid", balance: null, total: "42.00" })],
    }))],
    "2026-06-11T00:00:00.000Z",
  );
  assert.equal(dash.summary.totalOutstanding, 42);
  assert.equal(dash.customers[0].outstanding, 42);
});

test("buildBillingDashboard: a failed customer is skipped, counted, flips partial", () => {
  const dash = buildBillingDashboard(
    [
      entry("u1", "Alice", summary({
        invoices: [inv({ id: 1, status: "unpaid", balance: "10.00" })],
      })),
      entry("u2", "Bob", null),
      entry("u3", "Carol", summary({ unreachable: true })),
    ],
    "2026-06-11T00:00:00.000Z",
  );
  assert.equal(dash.summary.linkedCustomers, 3);
  assert.equal(dash.summary.customersLoaded, 1);
  assert.equal(dash.summary.customersFailed, 2);
  assert.equal(dash.summary.totalOutstanding, 10);
  assert.equal(dash.partial, true);
  assert.equal(dash.unreachable, false);
});

test("buildBillingDashboard: all customers failing flips unreachable", () => {
  const dash = buildBillingDashboard(
    [entry("u1", "Alice", null), entry("u2", "Bob", summary({ unreachable: true }))],
    "2026-06-11T00:00:00.000Z",
  );
  assert.equal(dash.unreachable, true);
  assert.equal(dash.partial, true);
  assert.equal(dash.customers.length, 0);
});

test("buildBillingDashboard: no entries is empty, not unreachable", () => {
  const dash = buildBillingDashboard([], "2026-06-11T00:00:00.000Z");
  assert.equal(dash.summary.linkedCustomers, 0);
  assert.equal(dash.unreachable, false);
  assert.equal(dash.partial, false);
  assert.equal(dash.customers.length, 0);
});

test("buildBillingDashboard: paid-up customer omitted from owing list but still aggregated", () => {
  const dash = buildBillingDashboard(
    [entry("u1", "Alice", summary({
      invoices: [inv({ id: 1, status: "paid", balance: "0.00" })],
      products: [prod({ status: "Active", billingCycle: "Monthly", amount: "9.00" })],
    }))],
    "2026-06-11T00:00:00.000Z",
  );
  assert.equal(dash.customers.length, 0);
  assert.equal(dash.summary.activeServices, 1);
  assert.equal(dash.summary.estimatedMrr, 9);
  assert.equal(dash.summary.totalOutstanding, 0);
});

test("buildBillingDashboard: customer name falls back to ServiceHub name when WHMCS client null", () => {
  const dash = buildBillingDashboard(
    [entry("u1", "Fallback Name", summary({
      client: null,
      invoices: [inv({ id: 1, status: "unpaid", balance: "3.00" })],
    }))],
    "2026-06-11T00:00:00.000Z",
  );
  assert.equal(dash.customers[0].name, "Fallback Name");
  assert.equal(dash.customers[0].clientId, 0);
});

// ---------- parseTransaction (Task #400) ----------
// GetTransactions rows normalize to date/description/gateway/amount(in|out)/
// currency. WHMCS's per-transaction `currency` is a numeric id, so display
// currency falls back to the client's currency unless a 3-letter code is given.

test("parseTransaction: normalizes a payment, drops the time, uses client currency", () => {
  const t = parseTransaction(
    { id: "12", date: "2026-06-01 14:32:00", description: "  Invoice Payment  ", gateway: "stripe", amountin: "39.95", amountout: "0.00", currency: "1" },
    "USD",
  );
  assert.equal(t.id, 12);
  assert.equal(t.date, "2026-06-01");
  assert.equal(t.description, "Invoice Payment");
  assert.equal(t.gateway, "stripe");
  assert.equal(t.amountIn, "39.95");
  // Zero amountout collapses to null.
  assert.equal(t.amountOut, null);
  // Numeric currency id is ignored in favour of the client currency.
  assert.equal(t.currencyCode, "USD");
  // No invoiceid on the row -> null link.
  assert.equal(t.invoiceId, null);
});

test("parseTransaction: captures a linked invoiceid, treats 0/absent as null", () => {
  // A transaction tied to an invoice carries the invoice id through.
  assert.equal(parseTransaction({ id: 1, invoiceid: "57", amountin: "10.00" }, "USD").invoiceId, 57);
  // WHMCS reports unlinked transactions with invoiceid 0 -> null.
  assert.equal(parseTransaction({ id: 2, invoiceid: "0", amountin: "10.00" }, "USD").invoiceId, null);
  assert.equal(parseTransaction({ id: 3, invoiceid: 0, amountin: "10.00" }, "USD").invoiceId, null);
  // Absent / non-numeric invoiceid -> null.
  assert.equal(parseTransaction({ id: 4, amountin: "10.00" }, "USD").invoiceId, null);
  assert.equal(parseTransaction({ id: 5, invoiceid: "abc", amountin: "10.00" }, "USD").invoiceId, null);
});

test("parseTransaction: a refund keeps amountOut and nulls a zero amountIn", () => {
  const t = parseTransaction({ id: 9, date: "2026-05-10", gateway: "stripe", amountin: "0.00", amountout: "15.00" }, "GBP");
  assert.equal(t.amountIn, null);
  assert.equal(t.amountOut, "15.00");
  // No description falls back cleanly to an empty string (UI fills it in).
  assert.equal(t.description, "");
});

test("parseTransaction: a 3-letter currency code on the row wins over the fallback", () => {
  const t = parseTransaction({ id: 1, date: "2026-01-01", amountin: "5.00", currency: "eur" }, "USD");
  assert.equal(t.currencyCode, "EUR");
});

test("parseTransaction: zero/empty date becomes null", () => {
  assert.equal(parseTransaction({ id: 1, date: "0000-00-00 00:00:00", amountin: "5.00" }, "USD").date, null);
});

// ---------- buildTransactionHistory ----------

test("buildTransactionHistory: sorts most-recent-first, id breaks same-day ties", () => {
  const history = buildTransactionHistory(
    okBilling({
      transactions: {
        transaction: [
          { id: 1, date: "2026-01-01", amountin: "10.00" },
          { id: 5, date: "2026-03-01", amountin: "30.00" },
          { id: 6, date: "2026-03-01", amountin: "40.00" }, // same day as #5, higher id -> first
          { id: 3, date: "2026-02-01", amountin: "20.00" },
        ],
      },
    }),
    "USD",
  );
  assert.equal(history.unreachable, false);
  assert.deepEqual(history.transactions.map((t) => t.id), [6, 5, 3, 1]);
});

test("buildTransactionHistory: single object collapses to a one-element array", () => {
  const history = buildTransactionHistory(
    okBilling({ transactions: { transaction: { id: 7, date: "2026-04-01", amountin: "9.00" } } }),
    "USD",
  );
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].id, 7);
});

test("parseTransaction: captures a service relid + builds the deep link, null when absent", () => {
  // A renewal transaction tied to a hosting service carries its id in `relid`.
  const renewal = parseTransaction(
    { id: 1, relid: "55", amountin: "20.00", description: "VPS Renewal" },
    "USD",
    "https://billing.example.com",
  );
  assert.equal(renewal.serviceId, 55);
  assert.equal(renewal.serviceUrl, "https://billing.example.com/clientarea.php?action=productdetails&id=55");
  // No relid (manual payment / add-funds) -> no linked service.
  const manual = parseTransaction({ id: 2, amountin: "10.00" }, "USD", "https://billing.example.com");
  assert.equal(manual.serviceId, null);
  assert.equal(manual.serviceUrl, null);
  // relid present but no base URL -> id captured, no deep link.
  const noBase = parseTransaction({ id: 3, relid: 7, amountin: "5.00" }, "USD");
  assert.equal(noBase.serviceId, 7);
  assert.equal(noBase.serviceUrl, null);
  // Zero / non-numeric relid stays unlinked.
  assert.equal(parseTransaction({ id: 4, relid: 0 }, "USD", "https://billing.example.com").serviceId, null);
  assert.equal(parseTransaction({ id: 5, relid: "abc" }, "USD", "https://billing.example.com").serviceId, null);
});

test("buildTransactionHistory: threads the base URL so a renewal transaction links its service", () => {
  const history = buildTransactionHistory(
    okBilling({ transactions: { transaction: { id: 9, relid: "55", date: "2026-05-01", amountin: "20.00" } } }),
    "USD",
    "https://billing.example.com",
  );
  assert.equal(history.transactions[0].serviceId, 55);
  assert.equal(history.transactions[0].serviceUrl, "https://billing.example.com/clientarea.php?action=productdetails&id=55");
});

test("buildTransactionHistory: no transactions yields an empty, reachable list", () => {
  const history = buildTransactionHistory(okBilling({ transactions: {} }), "USD");
  assert.deepEqual(history.transactions, []);
  assert.equal(history.unreachable, false);
});

test("buildTransactionHistory: a failed read degrades to empty + unreachable", () => {
  const history = buildTransactionHistory(fail(), "USD");
  assert.deepEqual(history.transactions, []);
  assert.equal(history.unreachable, true);
});

test("buildTransactionHistory: rows with no date sort last", () => {
  const history = buildTransactionHistory(
    okBilling({
      transactions: {
        transaction: [
          { id: 1, date: "0000-00-00", amountin: "10.00" },
          { id: 2, date: "2026-05-01", amountin: "20.00" },
        ],
      },
    }),
    "USD",
  );
  assert.deepEqual(history.transactions.map((t) => t.id), [2, 1]);
});

// ---------- loadTransactionHistory (ownership scoping, Task #400) ----------
// The fetcher is always invoked with the caller-supplied (session-derived)
// client id, so a customer can only read their own transactions; degradation
// flows straight through from buildTransactionHistory.

test("loadTransactionHistory: fetches scoped to the given client id and shapes the rows", async () => {
  let calledWith: number | null = null;
  const fetcher = async (clientId: number) => {
    calledWith = clientId;
    return { ok: true, data: { transactions: { transaction: [{ id: 1, date: "2026-05-01", amountin: "10.00" }] } } };
  };
  const history = await loadTransactionHistory(42, "USD", null, fetcher);
  assert.equal(calledWith, 42);
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].currencyCode, "USD");
});

test("loadTransactionHistory: a failed fetch degrades to empty + unreachable", async () => {
  const fetcher = async () => ({ ok: false, error: "boom", reason: "network" as const });
  const history = await loadTransactionHistory(42, "USD", null, fetcher);
  assert.deepEqual(history.transactions, []);
  assert.equal(history.unreachable, true);
});

// ---------- correlateTransactionService / applyTransactionServiceHints (Task #419) ----------
// WHMCS transactions rarely carry a relid, so the renewed service is correlated
// from the linked invoice's line items: a single distinct Hosting service id ->
// that service, named from the client's product list (line item desc fallback).

const BASE = "https://billing.example.com";

/** Build a Hosting line item carrying a service id (relid). */
function hostingLine(id: number, relid: number, description = ""): ParsedInvoiceLineItem {
  return parseInvoiceLineItem({ id, type: "Hosting", relid, description }, BASE);
}
/** Build a non-service (Domain) line item. */
function domainLine(id: number, description = "example.com"): ParsedInvoiceLineItem {
  return parseInvoiceLineItem({ id, type: "Domain", relid: 999, description }, BASE);
}

test("correlateTransactionService: one Hosting line resolves to its service, name from products", () => {
  const names = new Map<number, string>([[55, "VPS Pro"]]);
  const hint = correlateTransactionService([hostingLine(1, 55, "Web Hosting - mar")], names, BASE);
  assert.deepEqual(hint, {
    serviceId: 55,
    serviceName: "VPS Pro",
    serviceUrl: "https://billing.example.com/clientarea.php?action=productdetails&id=55",
  });
});

test("correlateTransactionService: falls back to the line item description when no product name", () => {
  const hint = correlateTransactionService([hostingLine(1, 7, "Cloud Server - April")], new Map(), BASE);
  assert.equal(hint?.serviceId, 7);
  assert.equal(hint?.serviceName, "Cloud Server - April");
});

test("correlateTransactionService: null for 0 services (no Hosting line), unloaded, or empty", () => {
  assert.equal(correlateTransactionService([domainLine(1)], new Map([[55, "VPS"]]), BASE), null);
  assert.equal(correlateTransactionService(undefined, new Map(), BASE), null);
  assert.equal(correlateTransactionService(null, new Map(), BASE), null);
  assert.equal(correlateTransactionService([], new Map(), BASE), null);
});

test("correlateTransactionService: null when 2+ distinct services (ambiguous)", () => {
  const names = new Map<number, string>([[55, "VPS"], [56, "Backup"]]);
  assert.equal(correlateTransactionService([hostingLine(1, 55), hostingLine(2, 56)], names, BASE), null);
});

test("correlateTransactionService: same service across two lines is still one service", () => {
  const names = new Map<number, string>([[55, "VPS Pro"]]);
  const hint = correlateTransactionService([hostingLine(1, 55, "Setup"), hostingLine(2, 55, "Renewal")], names, BASE);
  assert.equal(hint?.serviceId, 55);
  assert.equal(hint?.serviceName, "VPS Pro");
});

const txn = (over: Partial<ParsedTransaction>): ParsedTransaction => ({
  id: 1,
  invoiceId: null,
  date: "2026-05-01",
  description: "Payment",
  gateway: "stripe",
  amountIn: "10.00",
  amountOut: null,
  currencyCode: "USD",
  serviceId: null,
  serviceName: null,
  serviceUrl: null,
  ...over,
});

test("applyTransactionServiceHints: labels the linked row, leaves the others untouched", () => {
  const txns = [
    txn({ id: 1, invoiceId: 100 }),
    txn({ id: 2, invoiceId: null }), // unlinked manual payment
    txn({ id: 3, invoiceId: 200 }), // invoice not loaded
  ];
  const lineItems = new Map<number, ParsedInvoiceLineItem[]>([
    [100, [hostingLine(1, 55, "Web Hosting")]],
  ]);
  const out = applyTransactionServiceHints(txns, lineItems, [{ id: 55, name: "VPS Pro" }], BASE);
  assert.equal(out[0].serviceId, 55);
  assert.equal(out[0].serviceName, "VPS Pro");
  assert.equal(out[0].serviceUrl, "https://billing.example.com/clientarea.php?action=productdetails&id=55");
  // Unlinked + unloaded rows stay null.
  assert.equal(out[1].serviceName, null);
  assert.equal(out[2].serviceName, null);
});

test("applyTransactionServiceHints: multi-service invoice leaves the row unlabelled", () => {
  const txns = [txn({ id: 1, invoiceId: 100 })];
  const lineItems = new Map<number, ParsedInvoiceLineItem[]>([
    [100, [hostingLine(1, 55), hostingLine(2, 56)]],
  ]);
  const out = applyTransactionServiceHints(txns, lineItems, [{ id: 55, name: "A" }, { id: 56, name: "B" }], BASE);
  assert.equal(out[0].serviceName, null);
  assert.equal(out[0].serviceId, null);
});

test("loadTransactionHistoryWithServices: enriches each row via its invoice's line items", async () => {
  resetTransactionHistoryCache();
  const fetchTransactions = async () => okBilling({
    transactions: {
      transaction: [
        { id: 1, invoiceid: "100", date: "2026-05-02", amountin: "20.00" },
        { id: 2, invoiceid: "200", date: "2026-05-01", amountin: "5.00" },
      ],
    },
  });
  const invoices: Record<number, any> = {
    100: { invoiceid: 100, userid: 42, total: "20.00", status: "Paid", items: { item: [{ id: 1, type: "Hosting", relid: 55, description: "Web Hosting" }] } },
    200: { invoiceid: 200, userid: 42, total: "5.00", status: "Paid", items: { item: [{ id: 2, type: "Domain", relid: 999, description: "example.com" }] } },
  };
  let fetched: number[] = [];
  const fetchInvoice = async (id: number) => {
    fetched.push(id);
    return okBilling(invoices[id]);
  };
  const history = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(history.unreachable, false);
  // Hosting invoice -> labelled; domain-only invoice -> left null.
  assert.equal(history.transactions[0].serviceName, "VPS Pro");
  assert.equal(history.transactions[0].serviceId, 55);
  assert.equal(history.transactions[1].serviceName, null);
  // Only the linked invoices were fetched.
  assert.deepEqual(fetched.sort(), [100, 200]);
});

test("loadTransactionHistoryWithServices: a transactions outage flows through as unreachable, no invoice fetches", async () => {
  resetTransactionHistoryCache();
  let fetchedInvoice = false;
  const history = await loadTransactionHistoryWithServices(
    42, "USD", [], BASE,
    async () => ({ ok: false, error: "boom", reason: "network" as const }),
    async (id: number) => { fetchedInvoice = true; return okBilling({ invoiceid: id }); },
  );
  assert.deepEqual(history.transactions, []);
  assert.equal(history.unreachable, true);
  assert.equal(fetchedInvoice, false);
});

test("loadTransactionHistoryWithServices: an invoice that won't load leaves its row unlabelled", async () => {
  resetTransactionHistoryCache();
  const fetchTransactions = async () => okBilling({
    transactions: { transaction: [{ id: 1, invoiceid: "100", date: "2026-05-02", amountin: "20.00" }] },
  });
  const fetchInvoice = async () => ({ ok: false, error: "down", reason: "network" as const });
  const history = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(history.unreachable, false);
  assert.equal(history.transactions.length, 1);
  assert.equal(history.transactions[0].serviceName, null);
});

test("loadTransactionHistoryWithServices: an invoice owned by another client is not leaked", async () => {
  resetTransactionHistoryCache();
  const fetchTransactions = async () => okBilling({
    transactions: { transaction: [{ id: 1, invoiceid: "100", date: "2026-05-02", amountin: "20.00" }] },
  });
  // Invoice 100 belongs to client 99, not the caller (42).
  const fetchInvoice = async () => okBilling({
    invoiceid: 100, userid: 99, total: "20.00", status: "Paid",
    items: { item: [{ id: 1, type: "Hosting", relid: 55, description: "Web Hosting" }] },
  });
  const history = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(history.transactions[0].serviceName, null);
});

test("loadTransactionHistoryWithServices: a second view within the TTL serves the cache, no re-fetch", async () => {
  resetTransactionHistoryCache();
  let txnFetches = 0;
  let invoiceFetches = 0;
  const fetchTransactions = async () => {
    txnFetches++;
    return okBilling({
      transactions: { transaction: [{ id: 1, invoiceid: "100", date: "2026-05-02", amountin: "20.00" }] },
    });
  };
  const fetchInvoice = async (id: number) => {
    invoiceFetches++;
    return okBilling({
      invoiceid: id, userid: 42, total: "20.00", status: "Paid",
      items: { item: [{ id: 1, type: "Hosting", relid: 55, description: "Web Hosting" }] },
    });
  };
  const first = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  const second = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(first.transactions[0].serviceName, "VPS Pro");
  assert.deepEqual(second, first);
  // Both reads were served by a single set of WHMCS calls.
  assert.equal(txnFetches, 1);
  assert.equal(invoiceFetches, 1);
});

test("loadTransactionHistoryWithServices: a transactions outage is never pinned in the cache", async () => {
  resetTransactionHistoryCache();
  let txnFetches = 0;
  let down = true;
  const fetchTransactions = async () => {
    txnFetches++;
    if (down) return { ok: false as const, error: "boom", reason: "network" as const };
    return okBilling({
      transactions: { transaction: [{ id: 1, invoiceid: "100", date: "2026-05-02", amountin: "20.00" }] },
    });
  };
  const fetchInvoice = async (id: number) => okBilling({
    invoiceid: id, userid: 42, total: "20.00", status: "Paid",
    items: { item: [{ id: 1, type: "Hosting", relid: 55, description: "Web Hosting" }] },
  });
  const outage = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(outage.unreachable, true);
  // WHMCS recovers; the next view must re-fetch rather than serve the outage.
  down = false;
  const recovered = await loadTransactionHistoryWithServices(
    42, "USD", [{ id: 55, name: "VPS Pro" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(recovered.unreachable, false);
  assert.equal(recovered.transactions[0].serviceName, "VPS Pro");
  assert.equal(txnFetches, 2);
});

test("loadTransactionHistoryWithServices: separate clients never share a cache entry", async () => {
  resetTransactionHistoryCache();
  const fetchTransactions = async (clientId: number) => okBilling({
    transactions: { transaction: [{ id: clientId, invoiceid: String(clientId), date: "2026-05-02", amountin: "20.00" }] },
  });
  const fetchInvoice = async (id: number) => okBilling({
    invoiceid: id, userid: id, total: "20.00", status: "Paid",
    items: { item: [{ id: 1, type: "Hosting", relid: id, description: "Web Hosting" }] },
  });
  const a = await loadTransactionHistoryWithServices(
    11, "USD", [{ id: 11, name: "Alpha" }], BASE, fetchTransactions, fetchInvoice,
  );
  const b = await loadTransactionHistoryWithServices(
    22, "USD", [{ id: 22, name: "Beta" }], BASE, fetchTransactions, fetchInvoice,
  );
  assert.equal(a.transactions[0].serviceName, "Alpha");
  assert.equal(b.transactions[0].serviceName, "Beta");
});
