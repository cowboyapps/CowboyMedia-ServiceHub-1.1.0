import { userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";
import { shouldSuppressNotification, type QuietHoursUser } from "@shared/quiet-hours";
import type { User } from "@shared/schema";

type RecipientUser = Pick<User, "id" | "role" | "email" | "notificationPrefs"> &
  Partial<Pick<User, "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd" | "quietHoursTimezone" | "quietHoursAllowCritical">>;

function inQuietHours(u: RecipientUser, now?: Date): boolean {
  return shouldSuppressNotification({ user: u as QuietHoursUser, categoryKey: "news", now });
}

/**
 * Users (customers, admins, master_admins) who should receive a news push.
 * Admins are users too — they may opt into / out of news the same way
 * customers do via their notification prefs.
 *
 * `now` is injectable so tests can pin the quiet-hours check to a fixed
 * moment (production callers always omit it and get `new Date()`).
 */
export function selectNewsPushRecipients<T extends RecipientUser>(users: T[], now?: Date): T[] {
  return users.filter((u) =>
    userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "push") &&
    !inQuietHours(u, now),
  );
}

/**
 * Users (with email) who should receive a news email. Honours each
 * user's prefs regardless of role and skips users without an email or
 * those currently within their quiet-hours window.
 */
export function selectNewsEmailRecipientUsers<T extends RecipientUser>(users: T[], now?: Date): T[] {
  return users.filter(
    (u) =>
      !!u.email &&
      userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "email") &&
      !inQuietHours(u, now),
  );
}

/**
 * Email addresses that should receive a news email digest.
 */
export function selectNewsEmailRecipients<T extends RecipientUser>(users: T[], now?: Date): string[] {
  return selectNewsEmailRecipientUsers(users, now).map((u) => u.email as string);
}

/**
 * Users who should get an in-app content notification card for a news story.
 *
 * Honours each user's per-category `in_app` pref so customers who muted the
 * news bell don't get a card. Quiet hours do NOT apply — the bell is a passive
 * surface, so a card still waits there for users who keep the in-app channel on.
 */
export function selectNewsInAppRecipients<T extends RecipientUser>(users: T[]): string[] {
  return users
    .filter((u) =>
      userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "in_app"),
    )
    .map((u) => u.id);
}
