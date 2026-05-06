import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addBusinessMinutes,
  averageMinutes,
  businessMinutesBetween,
  computeTicketSla,
} from "../server/sla";
import type { BusinessHours, Ticket, TicketCategory } from "../shared/schema";

const NY_BH: BusinessHours = {
  id: "singleton",
  enabled: true,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "17:00",
  timezone: "America/New_York",
  afterHoursMessage: "",
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const TOKYO_BH: BusinessHours = { ...NY_BH, timezone: "Asia/Tokyo" };

function ticket(overrides: Partial<Ticket>): Ticket {
  return {
    id: "t1",
    createdAt: new Date("2025-02-04T15:00:00Z"),
    firstResponseAt: null,
    closedAt: null,
    status: "open",
    ...overrides,
  } as Ticket;
}

const cat = (firstResponseTargetMinutes: number | null, resolutionTargetMinutes: number | null) =>
  ({ firstResponseTargetMinutes, resolutionTargetMinutes }) as Pick<
    TicketCategory,
    "firstResponseTargetMinutes" | "resolutionTargetMinutes"
  >;

test("averageMinutes returns null on empty and rounded mean otherwise", () => {
  assert.equal(averageMinutes([]), null);
  assert.equal(averageMinutes([10, 20, 30]), 20);
  assert.equal(averageMinutes([10, 11]), 11); // 10.5 -> 11 rounded
});

test("businessMinutesBetween: same-day intra-business hours (NY)", () => {
  // Tue Feb 4 2025 10:00 EST → 11:00 EST (UTC-5)
  const start = new Date("2025-02-04T15:00:00Z");
  const end = new Date("2025-02-04T16:00:00Z");
  assert.equal(businessMinutesBetween(start, end, NY_BH), 60);
});

test("businessMinutesBetween: clamps to business window when start/end outside hours", () => {
  // Tue Feb 4 06:00 EST → 19:00 EST. Window 09:00-17:00 = 8h = 480 min.
  const start = new Date("2025-02-04T11:00:00Z");
  const end = new Date("2025-02-04T24:00:00Z"); // 19:00 EST
  assert.equal(businessMinutesBetween(start, end, NY_BH), 480);
});

test("businessMinutesBetween: spans weekend (Fri 16:00 → Mon 10:00 NY)", () => {
  // Friday Feb 7 16:00 EST → Monday Feb 10 10:00 EST.
  // Fri: 16-17 = 60, Sat/Sun excluded, Mon: 09-10 = 60. Total = 120.
  const start = new Date("2025-02-07T21:00:00Z");
  const end = new Date("2025-02-10T15:00:00Z");
  assert.equal(businessMinutesBetween(start, end, NY_BH), 120);
});

test("businessMinutesBetween: spring-forward DST does not double-count or skip", () => {
  // Fri March 7 2025 14:00 EST → Mon March 10 14:00 EDT (DST switches Sun Mar 9 02:00).
  // Business minutes: Fri 14-17 = 180, Mon 09-14 = 300. Total = 480.
  const start = new Date("2025-03-07T19:00:00Z");
  const end = new Date("2025-03-10T18:00:00Z");
  assert.equal(businessMinutesBetween(start, end, NY_BH), 480);
});

test("businessMinutesBetween: fall-back DST does not double-count or skip", () => {
  // Fri Oct 31 14:00 EDT → Mon Nov 3 14:00 EST (DST ends Sun Nov 2 02:00).
  const start = new Date("2025-10-31T18:00:00Z");
  const end = new Date("2025-11-03T19:00:00Z");
  assert.equal(businessMinutesBetween(start, end, NY_BH), 480);
});

test("businessMinutesBetween: works with non-UTC, non-NY timezone (Tokyo)", () => {
  // Tue Feb 4 2025 10:00 JST → 11:00 JST (UTC+9).
  const start = new Date("2025-02-04T01:00:00Z");
  const end = new Date("2025-02-04T02:00:00Z");
  assert.equal(businessMinutesBetween(start, end, TOKYO_BH), 60);
});

test("businessMinutesBetween: weekend-only span returns 0", () => {
  // Sat Feb 8 10:00 EST → Sun Feb 9 16:00 EST.
  const start = new Date("2025-02-08T15:00:00Z");
  const end = new Date("2025-02-09T21:00:00Z");
  assert.equal(businessMinutesBetween(start, end, NY_BH), 0);
});

test("businessMinutesBetween: falls back to wall-clock when BH disabled", () => {
  const start = new Date("2025-02-08T15:00:00Z");
  const end = new Date("2025-02-08T16:30:00Z");
  assert.equal(businessMinutesBetween(start, end, { ...NY_BH, enabled: false }), 90);
});

test("businessMinutesBetween: falls back to wall-clock when daysOfWeek empty", () => {
  const start = new Date("2025-02-04T15:00:00Z");
  const end = new Date("2025-02-04T15:45:00Z");
  assert.equal(businessMinutesBetween(start, end, { ...NY_BH, daysOfWeek: [] }), 45);
});

test("businessMinutesBetween: invalid timezone is treated as UTC", () => {
  // 09:00 UTC → 10:00 UTC on a weekday; 60 min if interpreted as UTC business hours.
  const start = new Date("2025-02-04T09:00:00Z");
  const end = new Date("2025-02-04T10:00:00Z");
  assert.equal(businessMinutesBetween(start, end, { ...NY_BH, timezone: "Mars/Olympus" }), 60);
});

test("businessMinutesBetween: end <= start returns 0", () => {
  const t = new Date("2025-02-04T15:00:00Z");
  assert.equal(businessMinutesBetween(t, t, NY_BH), 0);
  assert.equal(businessMinutesBetween(t, new Date(t.getTime() - 1000), NY_BH), 0);
});

test("addBusinessMinutes: adds within a single business day (NY)", () => {
  // Tue Feb 4 10:00 EST + 120 min = 12:00 EST = 17:00 UTC.
  const result = addBusinessMinutes(new Date("2025-02-04T15:00:00Z"), 120, NY_BH);
  assert.equal(result.toISOString(), "2025-02-04T17:00:00.000Z");
});

test("addBusinessMinutes: rolls past weekend (Fri 16:00 + 120m → Mon 10:00 NY)", () => {
  // Fri Feb 7 16:00 EST + 120 min: 60 to close, 60 into Mon 09:00-10:00 EST.
  const result = addBusinessMinutes(new Date("2025-02-07T21:00:00Z"), 120, NY_BH);
  assert.equal(result.toISOString(), "2025-02-10T15:00:00.000Z");
});

test("addBusinessMinutes: returned wall-clock crosses spring-forward DST correctly", () => {
  // Fri Mar 7 16:00 EST + 120 min: 60 to close, 60 into Mon Mar 10 09:00-10:00 EDT.
  // Mon 10:00 EDT = 14:00 UTC.
  const result = addBusinessMinutes(new Date("2025-03-07T21:00:00Z"), 120, NY_BH);
  assert.equal(result.toISOString(), "2025-03-10T14:00:00.000Z");
});

test("addBusinessMinutes: starting outside hours waits for next open window", () => {
  // Sat Feb 8 10:00 EST + 60 min → Mon Feb 10 10:00 EST = 15:00 UTC.
  const result = addBusinessMinutes(new Date("2025-02-08T15:00:00Z"), 60, NY_BH);
  assert.equal(result.toISOString(), "2025-02-10T15:00:00.000Z");
});

test("addBusinessMinutes: minutes <= 0 returns start unchanged", () => {
  const start = new Date("2025-02-04T15:00:00Z");
  assert.equal(addBusinessMinutes(start, 0, NY_BH).toISOString(), start.toISOString());
  assert.equal(addBusinessMinutes(start, -10, NY_BH).toISOString(), start.toISOString());
});

test("addBusinessMinutes: falls back to wall-clock when BH disabled", () => {
  const start = new Date("2025-02-08T15:00:00Z");
  const result = addBusinessMinutes(start, 90, { ...NY_BH, enabled: false });
  assert.equal(result.getTime() - start.getTime(), 90 * 60_000);
});

test("computeTicketSla: 'met' when first response & resolution within targets", () => {
  // Created Tue 10:00 EST, first response 10:30, closed 11:00 EST.
  const t = ticket({
    createdAt: new Date("2025-02-04T15:00:00Z"),
    firstResponseAt: new Date("2025-02-04T15:30:00Z"),
    closedAt: new Date("2025-02-04T16:00:00Z"),
    status: "closed",
  });
  const result = computeTicketSla(t, cat(60, 120), NY_BH, new Date("2025-02-04T16:00:00Z"));
  assert.equal(result.firstResponse.state, "met");
  assert.equal(result.firstResponse.elapsedMinutes, 30);
  assert.equal(result.resolution.state, "met");
  assert.equal(result.resolution.elapsedMinutes, 60);
  assert.equal(result.worstState, "met");
});

test("computeTicketSla: 'breached' when first response after target", () => {
  const t = ticket({
    createdAt: new Date("2025-02-04T15:00:00Z"),
    firstResponseAt: new Date("2025-02-04T17:00:00Z"), // 120 business min later
  });
  const result = computeTicketSla(t, cat(60, null), NY_BH, new Date("2025-02-04T17:00:00Z"));
  assert.equal(result.firstResponse.state, "breached");
  assert.equal(result.firstResponse.elapsedMinutes, 120);
  assert.equal(result.worstState, "breached");
});

test("computeTicketSla: 'approaching' when elapsed >= 80% of target on open ticket", () => {
  const t = ticket({ createdAt: new Date("2025-02-04T15:00:00Z") });
  // 50 business minutes elapsed, target 60 → 83% → approaching.
  const now = new Date("2025-02-04T15:50:00Z");
  const result = computeTicketSla(t, cat(60, null), NY_BH, now);
  assert.equal(result.firstResponse.state, "approaching");
  assert.equal(result.firstResponse.elapsedMinutes, 50);
});

test("computeTicketSla: 'on_track' when elapsed < 80% of target", () => {
  const t = ticket({ createdAt: new Date("2025-02-04T15:00:00Z") });
  const now = new Date("2025-02-04T15:30:00Z");
  const result = computeTicketSla(t, cat(60, null), NY_BH, now);
  assert.equal(result.firstResponse.state, "on_track");
  assert.equal(result.firstResponse.elapsedMinutes, 30);
});

test("computeTicketSla: 'none' when category has no targets", () => {
  const t = ticket({ createdAt: new Date("2025-02-04T15:00:00Z") });
  const result = computeTicketSla(t, cat(null, null), NY_BH, new Date("2025-02-05T15:00:00Z"));
  assert.equal(result.firstResponse.state, "none");
  assert.equal(result.resolution.state, "none");
  assert.equal(result.worstState, "none");
});

test("computeTicketSla: closed without reply freezes first-response clock at close", () => {
  // Created Tue 10:00 EST, closed Tue 10:30 EST without firstResponseAt; later 'now' shouldn't keep growing elapsed.
  const t = ticket({
    createdAt: new Date("2025-02-04T15:00:00Z"),
    closedAt: new Date("2025-02-04T15:30:00Z"),
    status: "closed",
  });
  const farFuture = new Date("2025-03-01T15:00:00Z");
  const result = computeTicketSla(t, cat(60, null), NY_BH, farFuture);
  // firstResponse uses effectiveNow = closedAt → elapsed = 30, target 60 → on_track (not breached).
  assert.equal(result.firstResponse.elapsedMinutes, 30);
  assert.equal(result.firstResponse.state, "on_track");
});

test("computeTicketSla: worstState ranks breached above approaching/on_track/met", () => {
  const t = ticket({
    createdAt: new Date("2025-02-04T15:00:00Z"),
    firstResponseAt: new Date("2025-02-04T15:30:00Z"), // met (30 <= 60)
  });
  // Resolution open, target 60, now = +120 business minutes → breached.
  const now = new Date("2025-02-04T17:00:00Z");
  const result = computeTicketSla(t, cat(60, 60), NY_BH, now);
  assert.equal(result.firstResponse.state, "met");
  assert.equal(result.resolution.state, "breached");
  assert.equal(result.worstState, "breached");
});
