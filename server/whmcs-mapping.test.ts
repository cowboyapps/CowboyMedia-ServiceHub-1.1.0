import { test } from "node:test";
import assert from "node:assert/strict";
import { toProductSummary } from "./whmcs";
import { deriveMappedServiceIds } from "./whmcs-billing";

// ---------- toProductSummary ----------
// WHMCS GetProducts rows key the product id as `pid` and carry a `groupname`.

test("toProductSummary: maps pid/name/groupname from a clean row", () => {
  assert.deepEqual(
    toProductSummary({ pid: 12, name: "  Cloud VPS  ", groupname: "  Hosting  " }),
    { id: 12, name: "Cloud VPS", groupName: "Hosting" },
  );
});

test("toProductSummary: falls back to `id` when `pid` is absent", () => {
  assert.deepEqual(
    toProductSummary({ id: 7, name: "Backup" }),
    { id: 7, name: "Backup", groupName: "" },
  );
});

test("toProductSummary: synthesizes a name from the id when name is blank", () => {
  assert.deepEqual(
    toProductSummary({ pid: 5, name: "   " }),
    { id: 5, name: "Product #5", groupName: "" },
  );
});

test("toProductSummary: degrades to id 0 + generic name on empty/garbage input", () => {
  assert.deepEqual(toProductSummary({}), { id: 0, name: "Product", groupName: "" });
  assert.deepEqual(toProductSummary(null), { id: 0, name: "Product", groupName: "" });
});

// ---------- deriveMappedServiceIds ----------
// Active products only; result deduped while preserving first-seen order.

const mappings = [
  { whmcsProductId: 12, serviceId: "svc-a" },
  { whmcsProductId: 12, serviceId: "svc-b" },
  { whmcsProductId: 20, serviceId: "svc-b" },
  { whmcsProductId: 20, serviceId: "svc-c" },
  { whmcsProductId: 99, serviceId: "svc-z" },
];

function product(pid: number, status: string) {
  return { id: pid * 100, pid, name: `P${pid}`, domain: "", status, nextDueDate: null, billingCycle: "", amount: "" };
}

test("deriveMappedServiceIds: only ACTIVE products grant their services", () => {
  const result = deriveMappedServiceIds(
    [product(12, "Active"), product(20, "Suspended")],
    mappings,
  );
  assert.deepEqual(result, ["svc-a", "svc-b"]);
});

test("deriveMappedServiceIds: dedupes across products, preserving first-seen order", () => {
  const result = deriveMappedServiceIds(
    [product(12, "Active"), product(20, "Active")],
    mappings,
  );
  // svc-b is shared by 12 and 20 — must appear once, in first-seen order.
  assert.deepEqual(result, ["svc-a", "svc-b", "svc-c"]);
});

test("deriveMappedServiceIds: status match is case-insensitive", () => {
  assert.deepEqual(deriveMappedServiceIds([product(12, "active")], mappings), ["svc-a", "svc-b"]);
  assert.deepEqual(deriveMappedServiceIds([product(12, "ACTIVE")], mappings), ["svc-a", "svc-b"]);
});

test("deriveMappedServiceIds: products with no mapping yield nothing", () => {
  assert.deepEqual(deriveMappedServiceIds([product(77, "Active")], mappings), []);
});

test("deriveMappedServiceIds: empty inputs yield an empty list", () => {
  assert.deepEqual(deriveMappedServiceIds([], mappings), []);
  assert.deepEqual(deriveMappedServiceIds([product(12, "Active")], []), []);
});
