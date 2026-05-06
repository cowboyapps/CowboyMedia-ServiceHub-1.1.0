import type { Request, Response } from "express";
import "express-session";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { updateBusinessHoursSchema, type BusinessHours, type UpdateBusinessHoursData } from "@shared/schema";

export function timeToMinutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function computeBusinessHoursStatus(bh: BusinessHours, now: Date = new Date()) {
  const baseMessage = bh.afterHoursMessage;
  if (!bh.enabled) {
    return {
      enabled: false,
      isOpen: true,
      message: baseMessage,
      timezone: bh.timezone,
      daysOfWeek: bh.daysOfWeek,
      startTime: bh.startTime,
      endTime: bh.endTime,
      nextOpenAt: null as string | null,
    };
  }
  const tz = isValidTimezone(bh.timezone) ? bh.timezone : "UTC";
  const startMin = timeToMinutes(bh.startTime);
  const endMin = timeToMinutes(bh.endTime);
  const days = new Set(bh.daysOfWeek);
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const todayDow = dowMap[formatInTimeZone(now, tz, "EEE")];
  const todayMin = timeToMinutes(formatInTimeZone(now, tz, "HH:mm"));
  const isOpen = startMin < endMin
    && days.has(todayDow)
    && todayMin >= startMin
    && todayMin < endMin;

  let nextOpenAt: string | null = null;
  if (!isOpen && days.size > 0 && startMin < endMin) {
    const todayDateStr = formatInTimeZone(now, tz, "yyyy-MM-dd");
    const [tyStr, tmStr, tdStr] = todayDateStr.split("-");
    const baseY = Number(tyStr);
    const baseM = Number(tmStr);
    const baseD = Number(tdStr);
    for (let i = 0; i < 8; i++) {
      const utcMidnight = Date.UTC(baseY, baseM - 1, baseD + i);
      const dt = new Date(utcMidnight);
      const yyyy = dt.getUTCFullYear();
      const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const dd = String(dt.getUTCDate()).padStart(2, "0");
      const dateStr = `${yyyy}-${mm}-${dd}`;
      const dowProbeUtc = fromZonedTime(`${dateStr}T12:00:00`, tz);
      const dow = dowMap[formatInTimeZone(dowProbeUtc, tz, "EEE")];
      if (!days.has(dow)) continue;
      const openUtc = fromZonedTime(`${dateStr}T${bh.startTime}:00`, tz);
      if (openUtc.getTime() > now.getTime()) {
        nextOpenAt = openUtc.toISOString();
        break;
      }
    }
  }

  return {
    enabled: true,
    isOpen,
    message: baseMessage,
    timezone: tz,
    daysOfWeek: bh.daysOfWeek,
    startTime: bh.startTime,
    endTime: bh.endTime,
    nextOpenAt,
  };
}

export interface BusinessHoursStorage {
  getBusinessHours(): Promise<BusinessHours>;
  updateBusinessHours(data: UpdateBusinessHoursData): Promise<BusinessHours>;
}

export interface BusinessHoursDeps {
  storage: BusinessHoursStorage;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; summary: string; details?: string },
  ) => void;
}

export function createBusinessHoursHandlers(deps: BusinessHoursDeps) {
  const { storage, logActivity } = deps;

  async function getPublicStatus(_req: Request, res: Response) {
    try {
      const bh = await storage.getBusinessHours();
      res.set("Cache-Control", "no-store");
      res.json(computeBusinessHoursStatus(bh));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function getAdmin(_req: Request, res: Response) {
    try {
      const bh = await storage.getBusinessHours();
      const status = computeBusinessHoursStatus(bh);
      res.json({
        enabled: bh.enabled,
        daysOfWeek: bh.daysOfWeek,
        startTime: bh.startTime,
        endTime: bh.endTime,
        timezone: bh.timezone,
        afterHoursMessage: bh.afterHoursMessage,
        isOpen: status.isOpen,
        nextOpenAt: status.nextOpenAt,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateBusinessHoursSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      if (data.timezone && !isValidTimezone(data.timezone)) {
        return res.status(400).json({ message: `Unknown timezone: ${data.timezone}` });
      }
      const current = await storage.getBusinessHours();
      const effectiveStart = data.startTime ?? current.startTime;
      const effectiveEnd = data.endTime ?? current.endTime;
      if (timeToMinutes(effectiveStart) >= timeToMinutes(effectiveEnd)) {
        return res.status(400).json({ message: "Open time must be earlier than close time" });
      }
      const updated = await storage.updateBusinessHours(data);
      logActivity("system", "business_hours_updated", {
        actorId: req.session.userId!,
        summary: `Business hours ${updated.enabled ? "enabled" : "disabled"} (${updated.startTime}–${updated.endTime} ${updated.timezone})`,
      });
      const status = computeBusinessHoursStatus(updated);
      res.json({
        enabled: updated.enabled,
        daysOfWeek: updated.daysOfWeek,
        startTime: updated.startTime,
        endTime: updated.endTime,
        timezone: updated.timezone,
        afterHoursMessage: updated.afterHoursMessage,
        isOpen: status.isOpen,
        nextOpenAt: status.nextOpenAt,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { getPublicStatus, getAdmin, patchAdmin };
}
