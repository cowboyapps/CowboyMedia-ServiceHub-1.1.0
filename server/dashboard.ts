import type { Request, Response } from "express";
import type { IStorage, DashboardMetrics } from "./storage";

export type DashboardHandlerOptions = {
  storage: Pick<IStorage, "getDashboardMetrics">;
  getOnlineUsersCount?: () => number | null;
  ttlMs?: number;
  now?: () => number;
};

export type DashboardResponse = DashboardMetrics & { cached: boolean; usersOnline: number | null };

export function createDashboardHandler(opts: DashboardHandlerOptions) {
  const ttl = opts.ttlMs ?? 30_000;
  const now = opts.now ?? Date.now;
  let cache: { at: number; payload: DashboardMetrics } | null = null;

  return async function handler(_req: Request, res: Response) {
    try {
      const t = now();
      let payload: DashboardMetrics;
      let cached = false;
      if (cache && t - cache.at < ttl) {
        payload = cache.payload;
        cached = true;
      } else {
        payload = await opts.storage.getDashboardMetrics();
        cache = { at: t, payload };
      }
      const usersOnline = opts.getOnlineUsersCount ? opts.getOnlineUsersCount() : null;
      const body: DashboardResponse = { ...payload, cached, usersOnline };
      res.json(body);
    } catch (e: any) {
      console.error("[Dashboard] failed:", e);
      res.status(500).json({ message: e?.message ?? "Dashboard failed" });
    }
  };
}
