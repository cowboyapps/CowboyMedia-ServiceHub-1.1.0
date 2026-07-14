import { test } from "node:test";
import assert from "node:assert/strict";
import { subsForAudience, pushAudienceForUrl } from "./push-audience";

const admin = { appScope: "admin", id: "a" };
const customer = { appScope: "customer", id: "c" };
const customer2 = { appScope: "customer", id: "c2" };

test("admin-audience push goes only to admin-app subscriptions when present", () => {
  assert.deepEqual(subsForAudience([admin, customer, customer2], "admin"), [admin]);
});

test("admin-audience push falls back to all subs when no admin-app subscription exists", () => {
  assert.deepEqual(subsForAudience([customer, customer2], "admin"), [customer, customer2]);
});

test("customer-audience push goes only to customer-app subscriptions when present", () => {
  assert.deepEqual(subsForAudience([admin, customer], "customer"), [customer]);
});

test("customer-audience push falls back to all subs when only admin-app subscriptions exist", () => {
  assert.deepEqual(subsForAudience([admin], "customer"), [admin]);
});

test("empty subscription list stays empty", () => {
  assert.deepEqual(subsForAudience([], "admin"), []);
});

test("pushAudienceForUrl classifies /admin deep links as admin", () => {
  assert.equal(pushAudienceForUrl("/admin"), "admin");
  assert.equal(pushAudienceForUrl("/admin?tab=alerts"), "admin");
  assert.equal(pushAudienceForUrl("/admin/anything"), "admin");
});

test("pushAudienceForUrl classifies everything else as customer", () => {
  assert.equal(pushAudienceForUrl("/tickets/1"), "customer");
  assert.equal(pushAudienceForUrl("/administrivia"), "customer");
  assert.equal(pushAudienceForUrl(undefined), "customer");
});
