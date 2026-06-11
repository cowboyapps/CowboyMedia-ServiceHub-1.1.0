export type NotificationChannel = "push" | "email";
export type NotificationRole = "customer" | "admin";

export interface NotificationCategoryPref {
  push?: boolean;
  email?: boolean;
}

export type NotificationPrefs = Record<string, NotificationCategoryPref>;

export interface NotificationCategory {
  key: string;
  label: string;
  description: string;
  group: string;
  channels: NotificationChannel[];
  /** Roles that may see/use this category. Defaults to ["customer"]. */
  roles?: NotificationRole[];
  /** If true, only master_admin can enable this (admin-only). */
  requiresMasterAdmin?: boolean;
  /** When the user has not set an explicit value, the default is OFF. */
  defaultOff?: boolean;
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
  // ---- Customer categories ----
  {
    key: "ticket_reply",
    label: "Replies on your tickets",
    description: "When an admin responds to your support ticket",
    group: "Tickets",
    channels: ["push", "email"],
  },
  {
    key: "ticket_claimed",
    label: "Ticket claimed",
    description: "When an admin picks up your ticket",
    group: "Tickets",
    channels: ["push", "email"],
  },
  {
    key: "ticket_transferred",
    label: "Ticket transferred",
    description: "When your ticket is reassigned to a different admin",
    group: "Tickets",
    channels: ["push", "email"],
  },
  {
    key: "ticket_received",
    label: "Ticket submission confirmation",
    description: "Confirmation that we received your ticket",
    group: "Tickets",
    channels: ["push", "email"],
  },
  {
    key: "ticket_closed",
    label: "Ticket closed (with transcript)",
    description: "When your ticket is closed; the email includes the full conversation",
    group: "Tickets",
    channels: ["email"],
  },
  {
    key: "whmcs_ticket_reply",
    label: "Replies on your billing tickets",
    description: "When our team replies to one of your billing & account support tickets",
    group: "Tickets",
    channels: ["push", "email"],
  },
  {
    key: "report_received",
    label: "Report submission confirmation",
    description: "Confirmation that we received your report or request",
    group: "Reports",
    channels: ["email"],
  },
  {
    key: "report_update",
    label: "Report status updates",
    description: "When the status of your report changes",
    group: "Reports",
    channels: ["push", "email"],
  },
  {
    key: "private_message",
    label: "Private messages",
    description: "When an admin sends you a direct message",
    group: "Messages",
    channels: ["push", "email"],
  },
  {
    key: "thread_message",
    label: "Conversation replies",
    description: "When you receive a reply in an ongoing conversation",
    group: "Messages",
    channels: ["push", "email"],
  },
  {
    key: "service_status",
    label: "Service status changes",
    description: "When a service you follow changes status",
    group: "Service status",
    channels: ["push", "email"],
  },
  {
    key: "service_alert",
    label: "Service alerts",
    description: "New alerts for services you follow",
    group: "Service status",
    channels: ["push", "email"],
  },
  {
    key: "service_update",
    label: "Service updates",
    description: "General updates posted for services you follow",
    group: "Service status",
    channels: ["push", "email"],
  },
  {
    key: "news",
    label: "News stories",
    description: "When a new news story is published",
    group: "News",
    channels: ["push", "email"],
  },
  {
    key: "setup_reminder",
    label: "Account setup reminder",
    description: "One-time reminder if you haven't finished setting up your account",
    group: "Reminders",
    channels: ["email"],
  },

  // ---- Admin categories (push-only) ----
  {
    key: "admin_new_ticket",
    label: "New ticket",
    description: "When a customer opens a new support ticket assigned to your role",
    group: "Admin tickets",
    channels: ["push"],
    roles: ["admin"],
  },
  {
    key: "admin_ticket_reply_mine",
    label: "Reply on my ticket",
    description: "When a customer replies on a ticket you've claimed",
    group: "Admin tickets",
    channels: ["push"],
    roles: ["admin"],
  },
  {
    key: "admin_ticket_reply_any",
    label: "Reply on any open ticket",
    description: "Replies on any open ticket (master admin only). Off by default.",
    group: "Admin tickets",
    channels: ["push"],
    roles: ["admin"],
    requiresMasterAdmin: true,
    defaultOff: true,
  },
  {
    key: "admin_monitor_down",
    label: "Service down (monitor)",
    description: "When a URL monitor goes down or recovers",
    group: "Admin monitoring",
    channels: ["push"],
    roles: ["admin"],
  },
  {
    key: "admin_chat_message",
    label: "Admin chat message",
    description: "When another admin sends you a message in admin chat",
    group: "Admin chat",
    channels: ["push"],
    roles: ["admin"],
  },
  {
    key: "admin_internal_note",
    label: "Internal note on ticket",
    description: "When another admin posts an internal note on a ticket",
    group: "Admin tickets",
    channels: ["push"],
    roles: ["admin"],
  },
  {
    key: "admin_broadcast",
    label: "Broadcast received",
    description: "Urgent admin broadcast pushes sent to your account",
    group: "Admin broadcasts",
    channels: ["push"],
    roles: ["admin"],
  },
];

export const NOTIFICATION_GROUPS = Array.from(
  new Set(NOTIFICATION_CATEGORIES.map((c) => c.group)),
);

export const NOTIFICATION_CATEGORY_KEYS = NOTIFICATION_CATEGORIES.map((c) => c.key);

const CATEGORY_BY_KEY: Record<string, NotificationCategory> = NOTIFICATION_CATEGORIES.reduce(
  (acc, cat) => {
    acc[cat.key] = cat;
    return acc;
  },
  {} as Record<string, NotificationCategory>,
);

export function getNotificationCategory(key: string): NotificationCategory | undefined {
  return CATEGORY_BY_KEY[key];
}

/** Returns the default channel value for a category when the user has no explicit pref. */
function defaultChannelValue(cat: NotificationCategory): boolean {
  return !cat.defaultOff;
}

export function userWantsChannel(
  prefs: NotificationPrefs | null | undefined,
  categoryKey: string,
  channel: NotificationChannel,
): boolean {
  const cat = getNotificationCategory(categoryKey);
  if (!cat || !cat.channels.includes(channel)) return false;
  const entry = prefs ? prefs[categoryKey] : undefined;
  if (!entry || typeof entry[channel] !== "boolean") return defaultChannelValue(cat);
  return entry[channel] !== false;
}

export type AppRole = "customer" | "admin" | "master_admin";

export function isCategoryVisibleToRole(cat: NotificationCategory, role: AppRole): boolean {
  const allowed = cat.roles ?? ["customer"];
  // Customer categories are visible to every role — admins are also users who
  // file tickets, follow services, and receive news. Admin-only categories
  // remain restricted to admin / master_admin.
  if (allowed.includes("customer")) {
    if (cat.requiresMasterAdmin && role !== "master_admin") return false;
    return true;
  }
  // Admin-only category: only admin and master_admin may see it.
  if (role === "customer") return false;
  if (cat.requiresMasterAdmin && role !== "master_admin") return false;
  return true;
}

export function getCategoriesForRole(role: AppRole): NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter((c) => isCategoryVisibleToRole(c, role));
}

export function getGroupsForRole(role: AppRole): string[] {
  return Array.from(new Set(getCategoriesForRole(role).map((c) => c.group)));
}

export function countEnabledChannels(
  prefs: NotificationPrefs | null | undefined,
  channel: NotificationChannel,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): { enabled: number; total: number } {
  const eligible = categories.filter((c) => c.channels.includes(channel));
  let enabled = 0;
  for (const cat of eligible) {
    if (userWantsChannel(prefs, cat.key, channel)) enabled++;
  }
  return { enabled, total: eligible.length };
}

export type GroupChannelState = "on" | "off" | "mixed" | "n/a";

export function getCategoriesForGroup(
  group: string,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): NotificationCategory[] {
  return categories.filter((c) => c.group === group);
}

export function getGroupChannelState(
  prefs: NotificationPrefs | null | undefined,
  group: string,
  channel: NotificationChannel,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): GroupChannelState {
  const eligible = getCategoriesForGroup(group, categories).filter((c) => c.channels.includes(channel));
  if (eligible.length === 0) return "n/a";
  let onCount = 0;
  for (const cat of eligible) {
    if (userWantsChannel(prefs, cat.key, channel)) onCount++;
  }
  if (onCount === eligible.length) return "on";
  if (onCount === 0) return "off";
  return "mixed";
}

export function applyGroupChannelToggle(
  prefs: NotificationPrefs | null | undefined,
  group: string,
  channel: NotificationChannel,
  enabled: boolean,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): NotificationPrefs {
  const next: NotificationPrefs = { ...(prefs ?? {}) };
  for (const cat of getCategoriesForGroup(group, categories)) {
    if (!cat.channels.includes(channel)) continue;
    next[cat.key] = { ...(next[cat.key] ?? {}), [channel]: enabled };
  }
  return next;
}

export function countEnabledGroups(
  prefs: NotificationPrefs | null | undefined,
  channel: NotificationChannel,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): { enabled: number; total: number } {
  const groups = Array.from(new Set(categories.map((c) => c.group)));
  let enabled = 0;
  let total = 0;
  for (const group of groups) {
    const state = getGroupChannelState(prefs, group, channel, categories);
    if (state === "n/a") continue;
    total++;
    if (state === "on") enabled++;
  }
  return { enabled, total };
}

export interface NotificationPreset {
  key: string;
  label: string;
  description: string;
  /** Group-name predicate per channel. Use "*" to mean all groups. */
  groups: Record<NotificationChannel, string[] | "*">;
}

const IMPORTANT_GROUPS = ["Tickets", "Messages", "Service status", "Admin tickets", "Admin chat", "Admin monitoring", "Admin broadcasts"];

export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  {
    key: "everything",
    label: "Everything",
    description: "All notifications on (default).",
    groups: { push: "*", email: "*" },
  },
  {
    key: "important",
    label: "Important only",
    description: "Tickets, messages, and service status only.",
    groups: { push: IMPORTANT_GROUPS, email: IMPORTANT_GROUPS },
  },
  {
    key: "email_only",
    label: "Email only",
    description: "Email notifications on, no push.",
    groups: { push: [], email: "*" },
  },
];

function presetIncludes(
  preset: NotificationPreset,
  channel: NotificationChannel,
  group: string,
): boolean {
  const set = preset.groups[channel];
  if (set === "*") return true;
  return set.includes(group);
}

export function buildPresetPrefs(
  preset: NotificationPreset,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): NotificationPrefs {
  const next: NotificationPrefs = {};
  for (const cat of categories) {
    const entry: NotificationCategoryPref = {};
    if (cat.channels.includes("push")) entry.push = presetIncludes(preset, "push", cat.group);
    if (cat.channels.includes("email")) entry.email = presetIncludes(preset, "email", cat.group);
    next[cat.key] = entry;
  }
  return next;
}

/** Returns the matching preset key, or null when the user's prefs are custom. */
export function matchPreset(
  prefs: NotificationPrefs | null | undefined,
  categories: NotificationCategory[] = NOTIFICATION_CATEGORIES,
): string | null {
  for (const preset of NOTIFICATION_PRESETS) {
    let matches = true;
    for (const cat of categories) {
      for (const channel of cat.channels) {
        const want = presetIncludes(preset, channel, cat.group);
        const has = userWantsChannel(prefs, cat.key, channel);
        if (want !== has) { matches = false; break; }
      }
      if (!matches) break;
    }
    if (matches) return preset.key;
  }
  return null;
}
