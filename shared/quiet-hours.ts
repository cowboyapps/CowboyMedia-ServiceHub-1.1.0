import { formatInTimeZone } from "date-fns-tz";

export interface QuietHoursUser {
  quietHoursEnabled?: boolean | null;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  quietHoursTimezone?: string | null;
  quietHoursAllowCritical?: boolean | null;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseHHMM(s: string | null | undefined): number | null {
  if (!s || !HHMM_RE.test(s)) return null;
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isInQuietHours(
  user: QuietHoursUser | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!user || !user.quietHoursEnabled) return false;
  const start = parseHHMM(user.quietHoursStart);
  const end = parseHHMM(user.quietHoursEnd);
  if (start == null || end == null) return false;
  if (start === end) return false;
  const tz = user.quietHoursTimezone && isValidTimezone(user.quietHoursTimezone)
    ? user.quietHoursTimezone
    : "UTC";
  let nowMinutes: number;
  try {
    const hhmm = formatInTimeZone(now, tz, "HH:mm");
    const [h, m] = hhmm.split(":").map(Number);
    nowMinutes = h * 60 + m;
  } catch {
    const hhmm = formatInTimeZone(now, "UTC", "HH:mm");
    const [h, m] = hhmm.split(":").map(Number);
    nowMinutes = h * 60 + m;
  }
  if (start < end) {
    return nowMinutes >= start && nowMinutes < end;
  }
  // Cross-midnight window (e.g. 22:00–07:00).
  return nowMinutes >= start || nowMinutes < end;
}

export function shouldSuppressNotification(opts: {
  user: QuietHoursUser | null | undefined;
  categoryKey: string;
  severity?: string | null;
  now?: Date;
}): boolean {
  const { user, categoryKey, severity, now } = opts;
  if (!isInQuietHours(user, now ?? new Date())) return false;
  if (
    user?.quietHoursAllowCritical &&
    categoryKey === "service_alert" &&
    severity === "critical"
  ) {
    return false;
  }
  return true;
}
