import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { BusinessHours, Ticket, TicketCategory } from "@shared/schema";

export type SlaState = "met" | "breached" | "approaching" | "on_track" | "none";

export type SlaMetric = {
  state: SlaState;
  targetMinutes: number | null;
  elapsedMinutes: number;
  remainingMinutes: number | null;
  dueAt: string | null;
  completedAt: string | null;
};

export type TicketSla = {
  firstResponse: SlaMetric;
  resolution: SlaMetric;
  worstState: SlaState;
};

/** Average business minutes for a metric across a set of completed durations. Returns null if no samples. */
export function averageMinutes(samples: number[]): number | null {
  if (samples.length === 0) return null;
  return Math.round(samples.reduce((a, b) => a + b, 0) / samples.length);
}

const DOW_MAP: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

function timeToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function bhUsable(bh: BusinessHours | null | undefined): boolean {
  if (!bh || !bh.enabled) return false;
  const startMin = timeToMinutes(bh.startTime);
  const endMin = timeToMinutes(bh.endTime);
  return endMin > startMin && (bh.daysOfWeek?.length ?? 0) > 0;
}

/** Business minutes between start and end. If business hours disabled or unusable, falls back to wall-clock minutes. */
export function businessMinutesBetween(start: Date, end: Date, bh: BusinessHours | null | undefined): number {
  if (end <= start) return 0;
  if (!bhUsable(bh)) return Math.floor((end.getTime() - start.getTime()) / 60000);
  const tz = isValidTimezone(bh!.timezone) ? bh!.timezone : "UTC";
  const days = new Set(bh!.daysOfWeek);
  const startDateStr = formatInTimeZone(start, tz, "yyyy-MM-dd");
  const [y, m, d] = startDateStr.split("-").map(Number);
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const dateStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    const probe = fromZonedTime(`${dateStr}T12:00:00`, tz);
    const dow = DOW_MAP[formatInTimeZone(probe, tz, "EEE")];
    const dayOpen = fromZonedTime(`${dateStr}T${bh!.startTime}:00`, tz);
    const dayClose = fromZonedTime(`${dateStr}T${bh!.endTime}:00`, tz);
    if (days.has(dow)) {
      const winStart = dayOpen > start ? dayOpen : start;
      const winEnd = dayClose < end ? dayClose : end;
      if (winEnd > winStart) total += (winEnd.getTime() - winStart.getTime()) / 60000;
    }
    if (dayClose >= end) break;
  }
  return Math.floor(total);
}

/** Returns the wall-clock Date `minutes` of business time after `start`. */
export function addBusinessMinutes(start: Date, minutes: number, bh: BusinessHours | null | undefined): Date {
  if (minutes <= 0) return start;
  if (!bhUsable(bh)) return new Date(start.getTime() + minutes * 60000);
  const tz = isValidTimezone(bh!.timezone) ? bh!.timezone : "UTC";
  const days = new Set(bh!.daysOfWeek);
  const startDateStr = formatInTimeZone(start, tz, "yyyy-MM-dd");
  const [y, m, d] = startDateStr.split("-").map(Number);
  let remaining = minutes;
  for (let i = 0; i < 400; i++) {
    const dt = new Date(Date.UTC(y, m - 1, d + i));
    const dateStr = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
    const probe = fromZonedTime(`${dateStr}T12:00:00`, tz);
    const dow = DOW_MAP[formatInTimeZone(probe, tz, "EEE")];
    if (!days.has(dow)) continue;
    const dayOpen = fromZonedTime(`${dateStr}T${bh!.startTime}:00`, tz);
    const dayClose = fromZonedTime(`${dateStr}T${bh!.endTime}:00`, tz);
    const winStart = dayOpen > start ? dayOpen : start;
    if (winStart >= dayClose) continue;
    const availMin = (dayClose.getTime() - winStart.getTime()) / 60000;
    if (remaining <= availMin) {
      return new Date(winStart.getTime() + remaining * 60000);
    }
    remaining -= availMin;
  }
  return new Date(start.getTime() + minutes * 60000);
}

function metricFor(
  startedAt: Date,
  completedAt: Date | null,
  targetMinutes: number | null | undefined,
  bh: BusinessHours | null | undefined,
  now: Date,
): SlaMetric {
  if (!targetMinutes || targetMinutes <= 0) {
    return { state: "none", targetMinutes: null, elapsedMinutes: 0, remainingMinutes: null, dueAt: null, completedAt: completedAt ? completedAt.toISOString() : null };
  }
  const dueAt = addBusinessMinutes(startedAt, targetMinutes, bh).toISOString();
  if (completedAt) {
    const elapsed = businessMinutesBetween(startedAt, completedAt, bh);
    return {
      state: elapsed <= targetMinutes ? "met" : "breached",
      targetMinutes,
      elapsedMinutes: elapsed,
      remainingMinutes: targetMinutes - elapsed,
      dueAt,
      completedAt: completedAt.toISOString(),
    };
  }
  const elapsed = businessMinutesBetween(startedAt, now, bh);
  const remaining = targetMinutes - elapsed;
  let state: SlaState = "on_track";
  if (elapsed > targetMinutes) state = "breached";
  else if (elapsed >= targetMinutes * 0.8) state = "approaching";
  return { state, targetMinutes, elapsedMinutes: elapsed, remainingMinutes: remaining, dueAt, completedAt: null };
}

const RANK: Record<SlaState, number> = { breached: 4, approaching: 3, on_track: 2, met: 1, none: 0 };

export function computeTicketSla(
  ticket: Pick<Ticket, "createdAt" | "firstResponseAt" | "closedAt" | "status">,
  category: Pick<TicketCategory, "firstResponseTargetMinutes" | "resolutionTargetMinutes"> | null | undefined,
  bh: BusinessHours | null | undefined,
  now: Date = new Date(),
): TicketSla {
  const created = new Date(ticket.createdAt);
  const resolved = ticket.status === "closed" && ticket.closedAt ? new Date(ticket.closedAt) : null;
  // Freeze the first-response clock at close time when ticket closed without a reply.
  const effectiveNow = !ticket.firstResponseAt && resolved && resolved < now ? resolved : now;
  const firstResponse = metricFor(
    created,
    ticket.firstResponseAt ? new Date(ticket.firstResponseAt) : null,
    category?.firstResponseTargetMinutes ?? null,
    bh,
    effectiveNow,
  );
  const resolution = metricFor(
    created,
    resolved,
    category?.resolutionTargetMinutes ?? null,
    bh,
    now,
  );
  // Worst state across both metrics that still apply (for closed tickets, only show the resolution result for open metric).
  const states: SlaState[] = [];
  if (firstResponse.state !== "none") states.push(firstResponse.state);
  if (resolution.state !== "none") states.push(resolution.state);
  const worst = states.length > 0
    ? states.reduce((a, b) => (RANK[a] >= RANK[b] ? a : b))
    : "none";
  return { firstResponse, resolution, worstState: worst };
}
