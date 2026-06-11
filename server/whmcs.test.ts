import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBaseUrl,
  deriveWhmcsRootFromUrl,
  normalizeClientsArray,
  toClientSummary,
  pickUnambiguousMatchByEmail,
} from "./whmcs";

// ---------- normalizeBaseUrl ----------
// Guards the "only call a real http(s) endpoint" property and strips trailing
// slashes so the `${baseUrl}/includes/api.php` concatenation never doubles up.

test("normalizeBaseUrl: strips trailing slashes", () => {
  assert.equal(normalizeBaseUrl("https://billing.example.com/"), "https://billing.example.com");
  assert.equal(normalizeBaseUrl("https://billing.example.com///"), "https://billing.example.com");
});

test("normalizeBaseUrl: keeps a clean URL untouched and trims whitespace", () => {
  assert.equal(normalizeBaseUrl("https://billing.example.com"), "https://billing.example.com");
  assert.equal(normalizeBaseUrl("  http://localhost:8080  "), "http://localhost:8080");
});

test("normalizeBaseUrl: rejects non-http(s) and empty values", () => {
  assert.equal(normalizeBaseUrl(null), null);
  assert.equal(normalizeBaseUrl(undefined), null);
  assert.equal(normalizeBaseUrl(""), null);
  assert.equal(normalizeBaseUrl("billing.example.com"), null);
  assert.equal(normalizeBaseUrl("ftp://billing.example.com"), null);
  assert.equal(normalizeBaseUrl("javascript:alert(1)"), null);
});

// ---------- deriveWhmcsRootFromUrl ----------
// Recovers the WHMCS root from the URL fetch lands on after a vanity-subdomain
// 301 redirect into the subfolder install's admin/client area.

test("deriveWhmcsRootFromUrl: recovers subfolder root from admin login redirect", () => {
  assert.equal(
    deriveWhmcsRootFromUrl("https://cowboymedia.net/billing/admin/login.php?redirect=%2Fbilling%2Fadmin%2F"),
    "https://cowboymedia.net/billing",
  );
});

test("deriveWhmcsRootFromUrl: strips clientarea / includes app subpaths", () => {
  assert.equal(deriveWhmcsRootFromUrl("https://example.com/billing/clientarea.php"), "https://example.com/billing");
  assert.equal(deriveWhmcsRootFromUrl("https://example.com/whmcs/includes/api.php"), "https://example.com/whmcs");
});

test("deriveWhmcsRootFromUrl: handles a redirect to the bare domain root", () => {
  assert.equal(deriveWhmcsRootFromUrl("https://example.com/admin/login.php"), "https://example.com");
  assert.equal(deriveWhmcsRootFromUrl("https://example.com/"), "https://example.com");
});

test("deriveWhmcsRootFromUrl: returns null for empty / invalid input", () => {
  assert.equal(deriveWhmcsRootFromUrl(null), null);
  assert.equal(deriveWhmcsRootFromUrl(undefined), null);
  assert.equal(deriveWhmcsRootFromUrl(""), null);
  assert.equal(deriveWhmcsRootFromUrl("not a url"), null);
});

// ---------- normalizeClientsArray ----------
// WHMCS GetClients returns clients.client as an array for many, a single object
// for exactly one, and omits the key for zero results. All three must collapse
// to a plain array so callers never branch on shape.

test("normalizeClientsArray: array passthrough", () => {
  const out = normalizeClientsArray({ client: [{ id: 1 }, { id: 2 }] });
  assert.deepEqual(out, [{ id: 1 }, { id: 2 }]);
});

test("normalizeClientsArray: single object becomes a one-element array", () => {
  const out = normalizeClientsArray({ client: { id: 7 } });
  assert.deepEqual(out, [{ id: 7 }]);
});

test("normalizeClientsArray: missing key / empty / null are empty arrays", () => {
  assert.deepEqual(normalizeClientsArray(undefined), []);
  assert.deepEqual(normalizeClientsArray(null), []);
  assert.deepEqual(normalizeClientsArray({}), []);
});

test("normalizeClientsArray: tolerates a bare array (no .client wrapper)", () => {
  assert.deepEqual(normalizeClientsArray([{ id: 5 }]), [{ id: 5 }]);
});

// ---------- toClientSummary ----------

test("toClientSummary: maps WHMCS fields and builds a person fullName", () => {
  const c = toClientSummary({ id: "42", firstname: "Ada", lastname: "Lovelace", companyname: "Analytical", email: "ADA@example.com ", status: "Active" });
  assert.equal(c.id, 42);
  assert.equal(c.firstName, "Ada");
  assert.equal(c.lastName, "Lovelace");
  assert.equal(c.fullName, "Ada Lovelace");
  assert.equal(c.companyName, "Analytical");
  // email is trimmed but case is preserved (matching lowercases at compare time)
  assert.equal(c.email, "ADA@example.com");
  assert.equal(c.status, "Active");
});

test("toClientSummary: falls back to company then Client #id for fullName", () => {
  assert.equal(toClientSummary({ id: 9, companyname: "Acme Co" }).fullName, "Acme Co");
  assert.equal(toClientSummary({ id: 9 }).fullName, "Client #9");
  assert.equal(toClientSummary({}).fullName, "Unknown client");
});

test("toClientSummary: accepts userid/client_id as id fallbacks", () => {
  assert.equal(toClientSummary({ userid: "13" }).id, 13);
  assert.equal(toClientSummary({ client_id: 21 }).id, 21);
});

// ---------- pickUnambiguousMatchByEmail ----------
// The auto-link safety gate: substring search must be filtered to an EXACT,
// case-insensitive, single email match or it returns null (no auto-link).

test("pickUnambiguousMatchByEmail: single exact match (case-insensitive)", () => {
  const clients = [
    { id: 1, email: "alice@example.com", firstname: "Alice" },
    { id: 2, email: "bob@example.com", firstname: "Bob" },
  ];
  const m = pickUnambiguousMatchByEmail(clients, "ALICE@example.com");
  assert.equal(m?.id, 1);
});

test("pickUnambiguousMatchByEmail: substring-only hits do not count", () => {
  // WHMCS `search` can return clients whose email merely contains the query.
  const clients = [{ id: 1, email: "alice@example.com" }];
  assert.equal(pickUnambiguousMatchByEmail(clients, "ali"), null);
});

test("pickUnambiguousMatchByEmail: ambiguous duplicate emails return null", () => {
  const clients = [
    { id: 1, email: "dup@example.com" },
    { id: 2, email: "DUP@example.com" },
  ];
  assert.equal(pickUnambiguousMatchByEmail(clients, "dup@example.com"), null);
});

test("pickUnambiguousMatchByEmail: zero matches / empty target return null", () => {
  assert.equal(pickUnambiguousMatchByEmail([{ id: 1, email: "x@example.com" }], "none@example.com"), null);
  assert.equal(pickUnambiguousMatchByEmail([], "x@example.com"), null);
  assert.equal(pickUnambiguousMatchByEmail([{ id: 1, email: "x@example.com" }], ""), null);
});
