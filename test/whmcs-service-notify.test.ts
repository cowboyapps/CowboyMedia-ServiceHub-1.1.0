import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeStatus,
  isRenewalDue,
  planServiceNotifications,
  serviceLabel,
  serviceRenewPhrase,
  serviceNotifTitle,
  serviceNotifBody,
  type ServiceNotifyCandidate,
  type ServiceMarkerMap,
} from "../shared/whmcs-service-notify";

const TODAY = "2026-06-11";
const RENEW_SOON_DAYS = 7;

const svc = (over: Partial<ServiceNotifyCandidate>): ServiceNotifyCandidate => ({
  id: 1,
  name: "Web Hosting",
  domain: "example.com",
  status: "Active",
  nextDueDate: "2026-09-01",
  ...over,
});

test("normalizeStatus: lowercases and trims", () => {
  assert.equal(normalizeStatus("  Suspended "), "suspended");
  assert.equal(normalizeStatus(null), "");
  assert.equal(normalizeStatus(undefined), "");
});

test("isRenewalDue: only active services inside the window", () => {
  assert.equal(isRenewalDue(svc({ status: "Active", nextDueDate: "2026-06-14" }), TODAY, RENEW_SOON_DAYS), true);
  assert.equal(isRenewalDue(svc({ status: "Active", nextDueDate: "2026-06-18" }), TODAY, RENEW_SOON_DAYS), true); // today+7
  assert.equal(isRenewalDue(svc({ status: "Active", nextDueDate: "2026-06-19" }), TODAY, RENEW_SOON_DAYS), false); // today+8
  assert.equal(isRenewalDue(svc({ status: "Suspended", nextDueDate: "2026-06-12" }), TODAY, RENEW_SOON_DAYS), false);
  assert.equal(isRenewalDue(svc({ status: "Active", nextDueDate: null }), TODAY, RENEW_SOON_DAYS), false);
});

test("planServiceNotifications: first sighting is a silent baseline", () => {
  const plans = planServiceNotifications([svc({ id: 7, status: "Suspended" })], {}, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].isBaseline, true);
  assert.equal(plans[0].statusEvent, null);
  assert.equal(plans[0].renewalEvent, false);
  assert.equal(plans[0].status, "suspended");
});

test("planServiceNotifications: active->suspended fires suspended", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "active", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Suspended" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].statusEvent, "suspended");
  assert.equal(plans[0].isBaseline, false);
});

test("planServiceNotifications: suspended->active fires unsuspended", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "suspended", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Active", nextDueDate: "2026-09-01" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].statusEvent, "unsuspended");
});

test("planServiceNotifications: suspended->terminated is NOT unsuspended", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "suspended", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Terminated" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].statusEvent, null);
  assert.equal(plans[0].status, "terminated");
});

test("planServiceNotifications: no status change, no renewal => no events", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "active", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Active", nextDueDate: "2026-09-01" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].statusEvent, null);
  assert.equal(plans[0].renewalEvent, false);
});

test("planServiceNotifications: renewal fires when in window and date not yet notified", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "active", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Active", nextDueDate: "2026-06-14" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].renewalEvent, true);
  assert.equal(plans[0].renewalDue, true);
});

test("planServiceNotifications: renewal does NOT re-fire for the same due date", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "active", lastRenewalNotified: "2026-06-14" } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Active", nextDueDate: "2026-06-14" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].renewalEvent, false);
});

test("planServiceNotifications: renewal re-fires once the due date advances to the next cycle", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "active", lastRenewalNotified: "2026-06-14" } };
  // WHMCS advanced nextDueDate to the next cycle; we're inside the window again.
  const plans = planServiceNotifications([svc({ id: 7, status: "Active", nextDueDate: "2026-06-16" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].renewalEvent, true);
});

test("planServiceNotifications: a suspended service gets no renewal reminder", () => {
  const markers: ServiceMarkerMap = { "7": { lastSeenStatus: "suspended", lastRenewalNotified: null } };
  const plans = planServiceNotifications([svc({ id: 7, status: "Suspended", nextDueDate: "2026-06-12" })], markers, TODAY, RENEW_SOON_DAYS);
  assert.equal(plans[0].renewalEvent, false);
  assert.equal(plans[0].renewalDue, false);
});

test("serviceLabel: name + domain, dedupes when equal, falls back", () => {
  assert.equal(serviceLabel(svc({ name: "Web Hosting", domain: "example.com" })), "Web Hosting (example.com)");
  assert.equal(serviceLabel(svc({ name: "example.com", domain: "example.com" })), "example.com");
  assert.equal(serviceLabel(svc({ name: "", domain: "example.com" })), "example.com");
  assert.equal(serviceLabel(svc({ name: "", domain: "" })), "your service");
});

test("serviceRenewPhrase: today / tomorrow / N days", () => {
  assert.equal(serviceRenewPhrase(TODAY, TODAY), "renews today");
  assert.equal(serviceRenewPhrase(TODAY, "2026-06-12"), "renews tomorrow");
  assert.equal(serviceRenewPhrase(TODAY, "2026-06-14"), "renews in 3 days");
  assert.equal(serviceRenewPhrase(TODAY, null), "is renewing soon");
});

test("serviceNotifTitle + serviceNotifBody: customer-friendly copy", () => {
  assert.equal(serviceNotifTitle("suspended"), "Service suspended");
  assert.equal(serviceNotifTitle("unsuspended"), "Service reactivated");
  assert.equal(serviceNotifTitle("renewal"), "Service renews soon");
  assert.equal(
    serviceNotifBody(svc({ name: "Web Hosting", domain: "example.com" }), "suspended", TODAY),
    "Your service Web Hosting (example.com) has been suspended.",
  );
  assert.equal(
    serviceNotifBody(svc({ name: "Web Hosting", domain: "example.com" }), "unsuspended", TODAY),
    "Your service Web Hosting (example.com) is active again.",
  );
  assert.equal(
    serviceNotifBody(svc({ name: "Web Hosting", domain: "example.com", nextDueDate: "2026-06-14" }), "renewal", TODAY),
    "Your service Web Hosting (example.com) renews in 3 days.",
  );
});
