export type NotificationChannel = "push" | "email";

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
}

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = [
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

export function userWantsChannel(
  prefs: NotificationPrefs | null | undefined,
  categoryKey: string,
  channel: NotificationChannel,
): boolean {
  const cat = getNotificationCategory(categoryKey);
  if (!cat || !cat.channels.includes(channel)) return false;
  if (!prefs) return true;
  const entry = prefs[categoryKey];
  if (!entry) return true;
  return entry[channel] !== false;
}

export function countEnabledChannels(
  prefs: NotificationPrefs | null | undefined,
  channel: NotificationChannel,
): { enabled: number; total: number } {
  const eligible = NOTIFICATION_CATEGORIES.filter((c) => c.channels.includes(channel));
  let enabled = 0;
  for (const cat of eligible) {
    if (userWantsChannel(prefs, cat.key, channel)) enabled++;
  }
  return { enabled, total: eligible.length };
}

export type GroupChannelState = "on" | "off" | "mixed" | "n/a";

export function getCategoriesForGroup(group: string): NotificationCategory[] {
  return NOTIFICATION_CATEGORIES.filter((c) => c.group === group);
}

export function getGroupChannelState(
  prefs: NotificationPrefs | null | undefined,
  group: string,
  channel: NotificationChannel,
): GroupChannelState {
  const eligible = getCategoriesForGroup(group).filter((c) => c.channels.includes(channel));
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
): NotificationPrefs {
  const next: NotificationPrefs = { ...(prefs ?? {}) };
  for (const cat of getCategoriesForGroup(group)) {
    if (!cat.channels.includes(channel)) continue;
    next[cat.key] = { ...(next[cat.key] ?? {}), [channel]: enabled };
  }
  return next;
}

export function countEnabledGroups(
  prefs: NotificationPrefs | null | undefined,
  channel: NotificationChannel,
): { enabled: number; total: number } {
  let enabled = 0;
  let total = 0;
  for (const group of NOTIFICATION_GROUPS) {
    const state = getGroupChannelState(prefs, group, channel);
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
  /** Groups that should be ON for the given channel under this preset. */
  groups: Record<NotificationChannel, string[]>;
}

const IMPORTANT_GROUPS = ["Tickets", "Messages", "Service status"];
const ALL_GROUPS = NOTIFICATION_GROUPS.slice();

export const NOTIFICATION_PRESETS: NotificationPreset[] = [
  {
    key: "everything",
    label: "Everything",
    description: "All notifications on (default).",
    groups: { push: ALL_GROUPS, email: ALL_GROUPS },
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
    groups: { push: [], email: ALL_GROUPS },
  },
];

export function buildPresetPrefs(preset: NotificationPreset): NotificationPrefs {
  const next: NotificationPrefs = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    const wantPush = cat.channels.includes("push") && preset.groups.push.includes(cat.group);
    const wantEmail = cat.channels.includes("email") && preset.groups.email.includes(cat.group);
    const entry: NotificationCategoryPref = {};
    if (cat.channels.includes("push")) entry.push = wantPush;
    if (cat.channels.includes("email")) entry.email = wantEmail;
    next[cat.key] = entry;
  }
  return next;
}

/** Returns the matching preset key, or null when the user's prefs are custom. */
export function matchPreset(prefs: NotificationPrefs | null | undefined): string | null {
  for (const preset of NOTIFICATION_PRESETS) {
    let matches = true;
    for (const cat of NOTIFICATION_CATEGORIES) {
      for (const channel of cat.channels) {
        const want = preset.groups[channel].includes(cat.group);
        const has = userWantsChannel(prefs, cat.key, channel);
        if (want !== has) { matches = false; break; }
      }
      if (!matches) break;
    }
    if (matches) return preset.key;
  }
  return null;
}
