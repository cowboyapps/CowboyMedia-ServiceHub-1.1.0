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
