// Server-side seeding + cached lookup for WHMCS notification wording overrides.
//
// The background notifiers (service / invoice / ticket) render their copy via
// the shared `renderNotification`, passing an optional admin override. Reading
// that override from the DB on every single notification would be wasteful, so
// this module keeps a short-lived in-memory cache of all rows keyed by
// templateKey, refreshed at most once per `CACHE_TTL_MS`. The admin routes call
// `invalidateNotificationTemplateCache()` after a PATCH/reset so edits take
// effect immediately rather than after the TTL.

import { storage } from "./storage";
import {
  NOTIFICATION_TEMPLATE_DEFS,
  type NotificationTemplateKey,
  type NotificationTemplateOverride,
} from "@shared/notification-templates";
import type { NotificationTemplate } from "@shared/schema";

const CACHE_TTL_MS = 60_000;

let cache: Map<string, NotificationTemplate> | null = null;
let cachedAt = 0;

async function loadCache(): Promise<Map<string, NotificationTemplate>> {
  const rows = await storage.getAllNotificationTemplates();
  const map = new Map<string, NotificationTemplate>();
  for (const row of rows) map.set(row.templateKey, row);
  cache = map;
  cachedAt = Date.now();
  return map;
}

/** Drop the cache so the next lookup re-reads from the DB (call after writes). */
export function invalidateNotificationTemplateCache(): void {
  cache = null;
  cachedAt = 0;
}

/**
 * Return the admin override for a template key, or null when none is stored.
 * The returned shape is what `renderNotification` expects (title/body/enabled);
 * a disabled or absent override makes the renderer fall back to the default.
 */
export async function getNotificationOverride(
  key: NotificationTemplateKey,
): Promise<NotificationTemplateOverride | null> {
  if (!cache || Date.now() - cachedAt > CACHE_TTL_MS) {
    try {
      await loadCache();
    } catch {
      // On a transient DB error, fail safe to the built-in default wording
      // rather than throwing into a fire-and-forget notifier.
      return null;
    }
  }
  const row = cache?.get(key);
  if (!row) return null;
  return { title: row.title, body: row.body, enabled: row.enabled };
}

/**
 * Seed/verify the notification-template rows from the shared defaults. Mirrors
 * seedEmailTemplates: inserts missing rows and keeps non-customized rows in sync
 * with the code defaults, never clobbering an admin's customized wording.
 */
export async function seedNotificationTemplates(): Promise<void> {
  for (const def of NOTIFICATION_TEMPLATE_DEFS) {
    await storage.upsertNotificationTemplate({
      templateKey: def.key,
      title: def.defaultTitle,
      body: def.defaultBody,
    });
  }
  invalidateNotificationTemplateCache();
  console.log("Notification templates seeded/verified");
}
