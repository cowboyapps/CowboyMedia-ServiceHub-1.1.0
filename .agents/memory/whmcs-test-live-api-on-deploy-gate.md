---
name: WHMCS billing tests must inject the summary loader
description: Why enriched-billing loader tests must stub loadBillingSummary instead of relying on ambient WHMCS reachability.
---

The deploy gate's `npm test` runs ON the production VPS, where WHMCS is fully
configured AND the VPS IP is allow-listed — so WHMCS API calls actually succeed.

**Rule:** any billing test that transitively calls the real `loadBillingSummary`
(via `loadCustomerBillingWithServices` / `loadBillingSummaryWithInvoiceServices`)
must inject a deterministic summary loader. Never let a test depend on whether
WHMCS happens to be reachable from the run environment.

**Why:** in the Replit dev/CI box, WHMCS rejects our egress IP ("Invalid IP")
so `loadBillingSummary` degrades to `unreachable:true` and `unreachable`-asserting
tests pass *by luck*. On the VPS deploy gate the same call returns a live,
reachable summary for the real client id, flipping `unreachable` to false and
failing those exact assertions — a green-locally / red-on-deploy flake. It also
means the deploy build was silently hammering the live WHMCS API.

**How to apply:** both loaders take a trailing optional
`loadSummary = loadBillingSummary` param (DI, same pattern as their
fetchTransactions/fetchInvoice params). Tests pass `loadUnreachableSummary`
(`buildBillingSummary(BASE, fail(), fail(), fail(), TODAY)`). Keep this DI seam
for any future loader whose default path reaches WHMCS.
