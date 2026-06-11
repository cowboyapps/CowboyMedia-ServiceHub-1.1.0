import type { Request, Response } from "express";
import "express-session";
import {
  updateWhmcsSettingsSchema,
  type WhmcsSettings,
  type UpdateWhmcsSettingsData,
} from "@shared/schema";
import { normalizeBaseUrl } from "./whmcs";

export interface WhmcsSettingsStorage {
  getWhmcsSettings(): Promise<WhmcsSettings | undefined>;
  updateWhmcsSettings(data: UpdateWhmcsSettingsData): Promise<WhmcsSettings>;
}

export interface WhmcsSettingsDeps {
  storage: WhmcsSettingsStorage;
  logActivity: (
    category: string,
    action: string,
    opts: { actorId?: string; summary: string; details?: string },
  ) => void;
  hasCredentials?: () => boolean;
}

// The public shape returned to the admin UI. Never includes secrets — only
// whether credentials are present (hasCredentials) and whether the connection
// is fully wired (configured = baseUrl present AND credentials present).
function shape(s: WhmcsSettings | undefined, hasCredentials: boolean) {
  const baseUrl = s?.baseUrl ?? "";
  return {
    baseUrl,
    enabled: !!s?.enabled,
    autoMatchByEmail: s?.autoMatchByEmail ?? true,
    adminUsername: s?.adminUsername ?? "",
    hasCredentials,
    configured: hasCredentials && !!normalizeBaseUrl(baseUrl),
  };
}

export function normalizeWhmcsPatch(data: UpdateWhmcsSettingsData): UpdateWhmcsSettingsData {
  const patch: UpdateWhmcsSettingsData = {};
  if (data.baseUrl !== undefined) {
    patch.baseUrl = typeof data.baseUrl === "string" ? (data.baseUrl.trim() || null) : null;
  }
  if (data.enabled !== undefined) patch.enabled = data.enabled;
  if (data.autoMatchByEmail !== undefined) patch.autoMatchByEmail = data.autoMatchByEmail;
  if (data.adminUsername !== undefined) {
    patch.adminUsername = typeof data.adminUsername === "string" ? (data.adminUsername.trim() || null) : null;
  }
  return patch;
}

export function createWhmcsSettingsHandlers(deps: WhmcsSettingsDeps) {
  const { storage, logActivity } = deps;
  const hasCredentials = deps.hasCredentials
    ?? (() => !!process.env.WHMCS_API_IDENTIFIER && !!process.env.WHMCS_API_SECRET);

  async function getAdmin(_req: Request, res: Response) {
    try {
      const settings = await storage.getWhmcsSettings();
      res.json(shape(settings, hasCredentials()));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateWhmcsSettingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid settings", errors: parsed.error.flatten() });
      }
      const patch = normalizeWhmcsPatch(parsed.data);
      const updated = await storage.updateWhmcsSettings(patch);
      logActivity("system", "whmcs_settings_updated", {
        actorId: req.session.userId!,
        summary: `WHMCS integration ${updated.enabled ? "enabled" : "disabled"}${updated.baseUrl ? ` (${updated.baseUrl})` : ""}`,
      });
      res.json(shape(updated, hasCredentials()));
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { getAdmin, patchAdmin };
}
