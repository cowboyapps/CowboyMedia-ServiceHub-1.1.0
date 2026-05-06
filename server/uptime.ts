import type { MonitorIncident } from "@shared/schema";

export type DailyStatus = "up" | "partial" | "down" | "unknown";

export interface UptimeResult {
  uptime30d: number | null;
  dailyBuckets: { date: string; status: DailyStatus; downtimeSeconds: number }[];
}

const DAY_MS = 86400000;

export function computeUptime(
  incidents: MonitorIncident[],
  hasMonitor: boolean,
  now: Date = new Date(),
  days: number = 90,
): UptimeResult {
  if (!hasMonitor) {
    return { uptime30d: null, dailyBuckets: [] };
  }

  const buckets: { date: string; downtime: number; ts: number }[] = [];
  const todayStart = new Date(now);
  todayStart.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(todayStart.getTime() - i * DAY_MS);
    buckets.push({
      date: d.toISOString().slice(0, 10),
      downtime: 0,
      ts: d.getTime(),
    });
  }
  const windowStart = buckets[0].ts;
  const windowEnd = now.getTime();

  for (const inc of incidents) {
    const start = new Date(inc.startedAt).getTime();
    const end = inc.resolvedAt ? new Date(inc.resolvedAt).getTime() : now.getTime();
    if (end < start) continue;
    if (end < windowStart || start > windowEnd) continue;
    for (const b of buckets) {
      const bStart = b.ts;
      const bEnd = b.ts + DAY_MS;
      const overlap = Math.max(
        0,
        Math.min(end, bEnd, windowEnd) - Math.max(start, bStart),
      );
      if (overlap > 0) b.downtime += overlap;
    }
  }

  const last30 = buckets.slice(-30);
  let total30 = 0;
  let down30 = 0;
  for (let i = 0; i < last30.length; i++) {
    const b = last30[i];
    const elapsed = Math.max(0, Math.min(now.getTime(), b.ts + DAY_MS) - b.ts);
    total30 += elapsed;
    down30 += Math.min(b.downtime, elapsed);
  }
  const uptime30d =
    total30 > 0
      ? Math.max(0, Math.min(100, ((total30 - down30) / total30) * 100))
      : null;

  const dailyBuckets = buckets.map((b) => {
    const elapsed = Math.max(0, Math.min(now.getTime(), b.ts + DAY_MS) - b.ts);
    let status: DailyStatus;
    if (elapsed === 0) {
      status = "unknown";
    } else {
      const ratio = b.downtime / elapsed;
      if (ratio === 0) status = "up";
      else if (ratio >= 0.05) status = "down";
      else status = "partial";
    }
    return {
      date: b.date,
      status,
      downtimeSeconds: Math.round(b.downtime / 1000),
    };
  });

  return { uptime30d, dailyBuckets };
}
