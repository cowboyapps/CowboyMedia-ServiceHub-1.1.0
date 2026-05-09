import { userWantsChannel, type NotificationPrefs } from "@shared/notification-categories";
import type { User } from "@shared/schema";

type RecipientUser = Pick<User, "id" | "role" | "email" | "notificationPrefs">;

/**
 * Users (customers, admins, master_admins) who should receive a news push.
 * Admins are users too — they may opt into / out of news the same way
 * customers do via their notification prefs.
 */
export function selectNewsPushRecipients<T extends RecipientUser>(users: T[]): T[] {
  return users.filter((u) =>
    userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "push"),
  );
}

/**
 * Email addresses that should receive a news email digest. Honours each
 * user's prefs regardless of role and skips users without an email.
 */
export function selectNewsEmailRecipients<T extends RecipientUser>(users: T[]): string[] {
  return users
    .filter(
      (u) =>
        !!u.email &&
        userWantsChannel(u.notificationPrefs as NotificationPrefs | null | undefined, "news", "email"),
    )
    .map((u) => u.email as string);
}

/** Users who should get an in-app content notification card for a news story. */
export function selectNewsInAppRecipients<T extends RecipientUser>(users: T[]): string[] {
  // In-app notification cards are always created for everyone (independent of
  // push/email prefs) so the bell icon stays in sync. Customers always; admins
  // also receive their own card.
  return users.map((u) => u.id);
}
