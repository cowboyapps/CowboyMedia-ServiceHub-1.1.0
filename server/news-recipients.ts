import { userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";
import { shouldSuppressNotification, type QuietHoursUser } from "@shared/quiet-hours";
import type { User } from "@shared/schema";

type RecipientUser = Pick<User, "id" | "role" | "email" | "notificationPrefs"> &
  Partial<Pick<User, "quietHoursEnabled" | "quietHoursStart" | "quietHoursEnd" | "quietHoursTimezone" | "quietHoursAllowCritical">>;

function inQuietHours(u: RecipientUser): boolean {
  return shouldSuppressNotification({ user: u as QuietHoursUser, categoryKey: "news" });
}

/**
 * Users (customers, admins, master_admins) who should receive a news push.
 * Admins are users too — they may opt into / out of news the same way
 * customers do via their notification prefs.
 */
export function selectNewsPushRecipients<T extends RecipientUser>(users: T[]): T[] {
  return users.filter((u) =>
    userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "push") &&
    !inQuietHours(u),
  );
}

/**
 * Users (with email) who should receive a news email. Honours each
 * user's prefs regardless of role and skips users without an email or
 * those currently within their quiet-hours window.
 */
export function selectNewsEmailRecipientUsers<T extends RecipientUser>(users: T[]): T[] {
  return users.filter(
    (u) =>
      !!u.email &&
      userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "email") &&
      !inQuietHours(u),
  );
}

/**
 * Email addresses that should receive a news email digest.
 */
export function selectNewsEmailRecipients<T extends RecipientUser>(users: T[]): string[] {
  return selectNewsEmailRecipientUsers(users).map((u) => u.email as string);
}

/** Users who should get an in-app content notification card for a news story. */
export function selectNewsInAppRecipients<T extends RecipientUser>(users: T[]): string[] {
  // In-app notification cards are always created for everyone (independent of
  // push/email prefs and quiet hours) so the bell icon stays in sync.
  return users.map((u) => u.id);
}
