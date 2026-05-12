import { test } from "node:test";
import assert from "node:assert/strict";
import { isInQuietHours, shouldSuppressNotification, type QuietHoursUser } from "./quiet-hours";

const baseUser: QuietHoursUser = {
  quietHoursEnabled: true,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  quietHoursTimezone: "UTC",
  quietHoursAllowCritical: true,
};

function utc(date: string): Date {
  return new Date(date);
}

test("isInQuietHours returns false when disabled", () => {
  assert.equal(isInQuietHours({ ...baseUser, quietHoursEnabled: false }, utc("2026-05-12T23:00:00Z")), false);
});

test("isInQuietHours returns false when user is null", () => {
  assert.equal(isInQuietHours(null, utc("2026-05-12T23:00:00Z")), false);
  assert.equal(isInQuietHours(undefined, utc("2026-05-12T23:00:00Z")), false);
});

test("isInQuietHours cross-midnight: inside window before midnight", () => {
  assert.equal(isInQuietHours(baseUser, utc("2026-05-12T23:30:00Z")), true);
});

test("isInQuietHours cross-midnight: inside window after midnight", () => {
  assert.equal(isInQuietHours(baseUser, utc("2026-05-12T03:00:00Z")), true);
});

test("isInQuietHours cross-midnight: outside window during day", () => {
  assert.equal(isInQuietHours(baseUser, utc("2026-05-12T15:00:00Z")), false);
});

test("isInQuietHours cross-midnight: end-exclusive at 07:00", () => {
  assert.equal(isInQuietHours(baseUser, utc("2026-05-12T07:00:00Z")), false);
  assert.equal(isInQuietHours(baseUser, utc("2026-05-12T06:59:00Z")), true);
});

test("isInQuietHours same-day window", () => {
  const u: QuietHoursUser = { ...baseUser, quietHoursStart: "09:00", quietHoursEnd: "17:00" };
  assert.equal(isInQuietHours(u, utc("2026-05-12T12:00:00Z")), true);
  assert.equal(isInQuietHours(u, utc("2026-05-12T08:00:00Z")), false);
  assert.equal(isInQuietHours(u, utc("2026-05-12T17:00:00Z")), false);
});

test("isInQuietHours start === end never matches", () => {
  const u: QuietHoursUser = { ...baseUser, quietHoursStart: "10:00", quietHoursEnd: "10:00" };
  assert.equal(isInQuietHours(u, utc("2026-05-12T10:00:00Z")), false);
});

test("isInQuietHours invalid HH:MM falls back to false", () => {
  const u: QuietHoursUser = { ...baseUser, quietHoursStart: "abc" };
  assert.equal(isInQuietHours(u, utc("2026-05-12T23:30:00Z")), false);
});

test("isInQuietHours respects America/New_York wall clock (DST in May)", () => {
  // 22:00–07:00 in New York. UTC offset during DST is -04:00.
  const u: QuietHoursUser = { ...baseUser, quietHoursTimezone: "America/New_York" };
  // 03:00 UTC === 23:00 EDT previous day → inside window.
  assert.equal(isInQuietHours(u, utc("2026-05-12T03:00:00Z")), true);
  // 18:00 UTC === 14:00 EDT → outside window.
  assert.equal(isInQuietHours(u, utc("2026-05-12T18:00:00Z")), false);
  // 11:00 UTC === 07:00 EDT → boundary, end-exclusive.
  assert.equal(isInQuietHours(u, utc("2026-05-12T11:00:00Z")), false);
  // 10:59 UTC === 06:59 EDT → still inside.
  assert.equal(isInQuietHours(u, utc("2026-05-12T10:59:00Z")), true);
});

test("isInQuietHours respects America/New_York wall clock during EST (winter, no DST)", () => {
  // In January NY is EST = UTC-5.
  const u: QuietHoursUser = { ...baseUser, quietHoursTimezone: "America/New_York" };
  // 03:00 UTC === 22:00 EST previous day → inside window.
  assert.equal(isInQuietHours(u, utc("2026-01-12T03:00:00Z")), true);
  // 12:00 UTC === 07:00 EST → end-exclusive boundary.
  assert.equal(isInQuietHours(u, utc("2026-01-12T12:00:00Z")), false);
  // 11:59 UTC === 06:59 EST → inside.
  assert.equal(isInQuietHours(u, utc("2026-01-12T11:59:00Z")), true);
});

test("shouldSuppressNotification suppresses when in quiet hours", () => {
  assert.equal(shouldSuppressNotification({ user: baseUser, categoryKey: "ticket_reply", now: utc("2026-05-12T23:30:00Z") }), true);
});

test("shouldSuppressNotification does not suppress outside quiet hours", () => {
  assert.equal(shouldSuppressNotification({ user: baseUser, categoryKey: "ticket_reply", now: utc("2026-05-12T15:00:00Z") }), false);
});

test("shouldSuppressNotification critical service_alert bypass when allowed", () => {
  assert.equal(
    shouldSuppressNotification({ user: baseUser, categoryKey: "service_alert", severity: "critical", now: utc("2026-05-12T23:30:00Z") }),
    false,
  );
});

test("shouldSuppressNotification non-critical service_alert still suppressed", () => {
  assert.equal(
    shouldSuppressNotification({ user: baseUser, categoryKey: "service_alert", severity: "warning", now: utc("2026-05-12T23:30:00Z") }),
    true,
  );
});

test("shouldSuppressNotification critical service_alert NOT bypassed when allowCritical=false", () => {
  const u = { ...baseUser, quietHoursAllowCritical: false };
  assert.equal(
    shouldSuppressNotification({ user: u, categoryKey: "service_alert", severity: "critical", now: utc("2026-05-12T23:30:00Z") }),
    true,
  );
});

test("shouldSuppressNotification critical bypass only applies to service_alert", () => {
  assert.equal(
    shouldSuppressNotification({ user: baseUser, categoryKey: "ticket_reply", severity: "critical", now: utc("2026-05-12T23:30:00Z") }),
    true,
  );
});

test("shouldSuppressNotification disabled quiet hours never suppresses", () => {
  const u = { ...baseUser, quietHoursEnabled: false };
  assert.equal(
    shouldSuppressNotification({ user: u, categoryKey: "ticket_reply", now: utc("2026-05-12T23:30:00Z") }),
    false,
  );
});
