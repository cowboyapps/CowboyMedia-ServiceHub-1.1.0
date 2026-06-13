import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaffRole, isUnlinkedStaff } from "./roles";

// ---------- isStaffRole ----------

test("isStaffRole: admin + master_admin are staff; everyone else is not", () => {
  assert.equal(isStaffRole("admin"), true);
  assert.equal(isStaffRole("master_admin"), true);
  assert.equal(isStaffRole("customer"), false);
  assert.equal(isStaffRole(""), false);
  assert.equal(isStaffRole(null), false);
  assert.equal(isStaffRole(undefined), false);
});

// ---------- isUnlinkedStaff ----------
// The single source of truth for "block this account from the customer-only
// WHMCS billing routes". Only staff WITHOUT their own whmcs_client_id are blocked;
// staff who are also linked WHMCS customers are served their own billing.

for (const role of ["admin", "master_admin"] as const) {
  test(`isUnlinkedStaff: ${role} with no linked client → blocked`, () => {
    assert.equal(isUnlinkedStaff(role, null), true);
    assert.equal(isUnlinkedStaff(role, undefined), true);
    assert.equal(isUnlinkedStaff(role, 0), true, "clientId 0 counts as unlinked");
  });

  test(`isUnlinkedStaff: ${role} WITH a linked client → served (not blocked)`, () => {
    assert.equal(isUnlinkedStaff(role, 100), false);
    assert.equal(isUnlinkedStaff(role, 1), false);
  });
}

test("isUnlinkedStaff: non-staff is never blocked, linked or not", () => {
  assert.equal(isUnlinkedStaff("customer", null), false);
  assert.equal(isUnlinkedStaff("customer", 100), false);
  assert.equal(isUnlinkedStaff(null, null), false);
  assert.equal(isUnlinkedStaff(undefined, 0), false);
});
