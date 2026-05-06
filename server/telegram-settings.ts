import type { Request, Response } from "express";
import "express-session";
import {
  updateTelegramSettingsSchema,
  type TelegramSettings,
  type UpdateTelegramSettingsData,
} from "@shared/schema";

export interface TelegramSettingsStorage {
  getTelegramSettings(): Promise<TelegramSettings | undefined>;
  updateTelegramSettings(data: UpdateTelegramSettingsData): Promise<TelegramSettings>;
}

export interface TelegramSettingsDeps {
  storage: TelegramSettingsStorage;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; summary: string; details?: string },
  ) => void;
  hasToken?: () => boolean;
}

function shape(s: TelegramSettings | undefined, hasToken: boolean) {
  return {
    chatId: s?.chatId ?? "",
    enabled: !!s?.enabled,
    sendAlerts: s?.sendAlerts ?? true,
    sendServiceUpdates: s?.sendServiceUpdates ?? true,
    sendNews: s?.sendNews ?? true,
    hasToken,
  };
}

export function normalizeTelegramPatch(data: UpdateTelegramSettingsData): UpdateTelegramSettingsData {
  const patch: UpdateTelegramSettingsData = {};
  if (data.chatId !== undefined) {
    patch.chatId = typeof data.chatId === "string" ? (data.chatId.trim() || null) : null;
  }
  if (data.enabled !== undefined) patch.enabled = data.enabled;
  if (data.sendAlerts !== undefined) patch.sendAlerts = data.sendAlerts;
  if (data.sendServiceUpdates !== undefined) patch.sendServiceUpdates = data.sendServiceUpdates;
  if (data.sendNews !== undefined) patch.sendNews = data.sendNews;
  return patch;
}

export function createTelegramSettingsHandlers(deps: TelegramSettingsDeps) {
  const { storage, logActivity } = deps;
  const hasToken = deps.hasToken ?? (() => !!process.env.TELEGRAM_BOT_TOKEN);

  async function getAdmin(_req: Request, res: Response) {
    try {
      const settings = await storage.getTelegramSettings();
      res.json(shape(settings, hasToken()));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateTelegramSettingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }
      const patch = normalizeTelegramPatch(parsed.data);
      const updated = await storage.updateTelegramSettings(patch);
      logActivity("system", "telegram_settings_updated", {
        actorId: req.session.userId!,
        summary: `Telegram notifications ${updated.enabled ? "enabled" : "disabled"}${updated.chatId ? ` (chat ${updated.chatId})` : ""}`,
      });
      res.json(shape(updated, hasToken()));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { getAdmin, patchAdmin };
}
