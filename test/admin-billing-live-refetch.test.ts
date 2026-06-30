import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression coverage for the admin per-user WHMCS billing panel staying fresh.
//
// The customer-facing billing page is already covered behaviorally by
// test/billing-live-refetch.test.ts: it mounts the page and proves the shared
// `liveQueryOptions` makes the queries refetch on focus/reconnect. The admin
// per-user panel relies on the SAME shared options under different query keys
// (the panel itself, its billing summary, derived services, and the invoice
// detail dialog). That panel lives inside the ~10k-line admin-portal.tsx and
// its section components aren't exported, so a mount test isn't practical.
//
// Two-pronged guard instead, mirroring test/chat-reconnect-wiring.test.ts:
//   1. Runtime: assert the shared `liveQueryOptions` object still has the
//      protective shape (finite staleTime + refetch on mount/focus/reconnect).
//      If someone weakens it, every panel below silently goes stale — fail loud.
//   2. Source-text: assert each admin billing query block still spreads
//      `...liveQueryOptions`, so dropping it from any one of them fails here.

const ADMIN_PORTAL = readFileSync(
  join(process.cwd(), "client/src/pages/admin-portal.tsx"), "utf8",
);
const BILLING_SUMMARY = readFileSync(
  join(process.cwd(), "client/src/components/billing-summary.tsx"), "utf8",
);

// --- 1. The shared options still force live refetching --------------------

test("liveQueryOptions keeps the live-refetch contract the admin panel depends on", async () => {
  const { liveQueryOptions } = await import("../client/src/lib/queryClient");
  assert.equal(typeof liveQueryOptions.staleTime, "number", "staleTime is set");
  assert.ok(
    Number.isFinite(liveQueryOptions.staleTime as number) &&
      (liveQueryOptions.staleTime as number) < Infinity,
    "staleTime must be finite so data can go stale and refetch",
  );
  assert.equal(liveQueryOptions.refetchOnWindowFocus, true, "refetch on focus");
  assert.equal(liveQueryOptions.refetchOnReconnect, true, "refetch on reconnect");
  assert.equal(liveQueryOptions.refetchOnMount, true, "refetch on mount");
});

// --- 2. Each admin per-user WHMCS billing query opts into it --------------

test("admin WHMCS customer panel query spreads ...liveQueryOptions", () => {
  assert.match(
    ADMIN_PORTAL,
    /queryKey:\s*\["\/api\/admin\/users",\s*userId,\s*"whmcs"\],\s*\.\.\.liveQueryOptions/,
    "the panel GET query must use liveQueryOptions",
  );
});

test("admin WHMCS billing summary query spreads ...liveQueryOptions", () => {
  assert.match(
    ADMIN_PORTAL,
    /queryKey:\s*\["\/api\/admin\/users",\s*userId,\s*"whmcs",\s*"billing"\],\s*\.\.\.liveQueryOptions/,
    "the billing summary query must use liveQueryOptions",
  );
});

test("admin WHMCS derived-services query spreads ...liveQueryOptions", () => {
  assert.match(
    ADMIN_PORTAL,
    /queryKey:\s*\["\/api\/admin\/users",\s*userId,\s*"whmcs",\s*"derived-services"\],\s*\.\.\.liveQueryOptions/,
    "the derived-services query must use liveQueryOptions",
  );
});

test("admin invoice-detail dialog query spreads ...liveQueryOptions", () => {
  // billing-summary.tsx builds the admin invoice-detail key, then the very next
  // useQuery spreads liveQueryOptions. Assert both the admin key form exists and
  // a liveQueryOptions-backed useQuery sits right after it.
  assert.match(
    BILLING_SUMMARY,
    /\["\/api\/admin\/users",\s*userId,\s*"whmcs",\s*"billing",\s*"invoices",\s*String\(invoiceId\)\]/,
    "admin invoice-detail query key form",
  );
  assert.match(
    BILLING_SUMMARY,
    /useQuery<InvoiceDetailPayload>\(\{[\s\S]*?\.\.\.liveQueryOptions/,
    "the invoice-detail query must use liveQueryOptions",
  );
});
