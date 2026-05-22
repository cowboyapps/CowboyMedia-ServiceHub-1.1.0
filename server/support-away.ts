import type { Request, Response } from "express";
import "express-session";
import {
  updateSupportAwaySchema,
  type SupportAwayMessage,
  type UpdateSupportAwayData,
} from "@shared/schema";

export type SupportAwayStatus = {
  enabled: boolean;
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
  message: string;
  updatedAt: string;
};

export function computeSupportAwayStatus(
  row: SupportAwayMessage,
  now: Date = new Date(),
): SupportAwayStatus {
  const startAt = row.startAt ? new Date(row.startAt) : null;
  const endAt = row.endAt ? new Date(row.endAt) : null;
  const hasWindow = !!startAt && !!endAt;
  const inWindow = hasWindow
    ? now.getTime() >= startAt!.getTime() && now.getTime() < endAt!.getTime()
    : false;
  const isActive = !!row.enabled && inWindow;
  return {
    enabled: !!row.enabled,
    isActive,
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    message: row.message,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface SupportAwayStorage {
  getSupportAway(): Promise<SupportAwayMessage>;
  updateSupportAway(
    data: UpdateSupportAwayData & { updatedBy?: string | null },
  ): Promise<SupportAwayMessage>;
}

export interface SupportAwayDeps {
  storage: SupportAwayStorage;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; summary: string; details?: string },
  ) => void;
}

export function createSupportAwayHandlers(deps: SupportAwayDeps) {
  const { storage, logActivity } = deps;

  async function getPublicStatus(_req: Request, res: Response) {
    try {
      const row = await storage.getSupportAway();
      res.set("Cache-Control", "no-store");
      res.json(computeSupportAwayStatus(row));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function getAdmin(_req: Request, res: Response) {
    try {
      const row = await storage.getSupportAway();
      const status = computeSupportAwayStatus(row);
      res.json({
        enabled: row.enabled,
        startAt: status.startAt,
        endAt: status.endAt,
        message: row.message,
        isActive: status.isActive,
        updatedAt: status.updatedAt,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateSupportAwaySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      const current = await storage.getSupportAway();
      const effectiveStart = data.startAt !== undefined
        ? (data.startAt ? new Date(data.startAt) : null)
        : current.startAt;
      const effectiveEnd = data.endAt !== undefined
        ? (data.endAt ? new Date(data.endAt) : null)
        : current.endAt;
      const effectiveEnabled = data.enabled !== undefined ? data.enabled : current.enabled;
      if (effectiveEnabled) {
        if (!effectiveStart || !effectiveEnd) {
          return res.status(400).json({ message: "Start and end time are required when away message is enabled" });
        }
        if (effectiveStart.getTime() >= effectiveEnd.getTime()) {
          return res.status(400).json({ message: "End time must be after start time" });
        }
      }
      const updated = await storage.updateSupportAway({
        ...data,
        updatedBy: req.session.userId,
      });
      logActivity("system", "support_away_updated", {
        actorId: req.session.userId,
        summary: `Support away message ${updated.enabled ? "enabled" : "disabled"}${
          updated.enabled && updated.startAt && updated.endAt
            ? ` (${updated.startAt.toISOString()} → ${updated.endAt.toISOString()})`
            : ""
        }`,
      });
      const status = computeSupportAwayStatus(updated);
      res.json({
        enabled: updated.enabled,
        startAt: status.startAt,
        endAt: status.endAt,
        message: updated.message,
        isActive: status.isActive,
        updatedAt: status.updatedAt,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { getPublicStatus, getAdmin, patchAdmin };
}
