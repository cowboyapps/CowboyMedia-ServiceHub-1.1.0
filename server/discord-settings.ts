import type { Request, Response } from "express";
import "express-session";
import {
  updateDiscordSettingsSchema,
  type DiscordSettings,
  type UpdateDiscordSettingsData,
} from "@shared/schema";

export interface DiscordSettingsStorage {
  getDiscordSettings(): Promise<DiscordSettings | undefined>;
  updateDiscordSettings(data: {
    webhookUrl?: string | null;
    enabled?: boolean;
    sendAlerts?: boolean;
    sendServiceUpdates?: boolean;
    sendNews?: boolean;
  }): Promise<DiscordSettings>;
}

export interface DiscordSettingsDeps {
  storage: DiscordSettingsStorage;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; summary: string; details?: string },
  ) => void;
}

export function maskWebhook(url: string | null | undefined): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] || "";
    const tail = last.length > 4 ? last.slice(-4) : last;
    return `${u.origin}/…/${tail ? "••••" + tail : "••••"}`;
  } catch {
    return "••••" + url.slice(-4);
  }
}

function shape(s: DiscordSettings | undefined) {
  return {
    webhookUrlMasked: maskWebhook(s?.webhookUrl),
    hasWebhook: !!s?.webhookUrl,
    enabled: !!s?.enabled,
    sendAlerts: s?.sendAlerts ?? true,
    sendServiceUpdates: s?.sendServiceUpdates ?? true,
    sendNews: s?.sendNews ?? true,
  };
}

export function normalizeDiscordPatch(
  data: UpdateDiscordSettingsData,
): { webhookUrl?: string | null; enabled?: boolean; sendAlerts?: boolean; sendServiceUpdates?: boolean; sendNews?: boolean } {
  const patch: ReturnType<typeof normalizeDiscordPatch> = {};
  if (data.webhookUrl !== undefined) {
    if (data.webhookUrl === null || data.webhookUrl === "") {
      patch.webhookUrl = null;
    } else {
      const trimmed = data.webhookUrl.trim();
      patch.webhookUrl = trimmed || null;
    }
  }
  if (data.enabled !== undefined) patch.enabled = data.enabled;
  if (data.sendAlerts !== undefined) patch.sendAlerts = data.sendAlerts;
  if (data.sendServiceUpdates !== undefined) patch.sendServiceUpdates = data.sendServiceUpdates;
  if (data.sendNews !== undefined) patch.sendNews = data.sendNews;
  return patch;
}

export function createDiscordSettingsHandlers(deps: DiscordSettingsDeps) {
  const { storage, logActivity } = deps;

  async function getAdmin(_req: Request, res: Response) {
    try {
      const settings = await storage.getDiscordSettings();
      res.json(shape(settings));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateDiscordSettingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        const flat = parsed.error.flatten();
        const webhookErrs = flat.fieldErrors.webhookUrl;
        if (webhookErrs && webhookErrs.length > 0) {
          return res.status(400).json({ message: webhookErrs[0] });
        }
        return res.status(400).json({ message: "Invalid settings", errors: flat });
      }
      const patch = normalizeDiscordPatch(parsed.data);
      const updated = await storage.updateDiscordSettings(patch);
      logActivity("system", "discord_settings_updated", {
        actorId: req.session.userId!,
        summary: `Discord notifications ${updated.enabled ? "enabled" : "disabled"}${updated.webhookUrl ? " (webhook configured)" : ""}`,
      });
      res.json(shape(updated));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { getAdmin, patchAdmin };
}
