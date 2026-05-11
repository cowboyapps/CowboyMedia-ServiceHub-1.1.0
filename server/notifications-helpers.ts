import type { UserNotification } from "@shared/schema";

export interface MarkGroupReadStorage {
  markUserNotificationRead(id: string, userId: string): Promise<void>;
  markUserNotificationsByReferenceRead(
    userId: string,
    referenceType: string,
    referenceId: string,
  ): Promise<number>;
}

/**
 * Marks the clicked notification row as read AND, if the row points at
 * a referenceable resource, every other unread row for the same
 * (referenceType, referenceId) pair belonging to the same user. Pairs
 * with the OS-toast rollup logic in `client/public/sw.js` so a single
 * "Mark as read" tap flips the whole group instead of leaving N - 1
 * stale rows behind.
 *
 * Returns the number of *additional* rows flipped by the group sweep
 * (0 if the notification has no reference, or if the bulk update only
 * touched the clicked row itself).
 */
export async function markGroupRead(
  storage: MarkGroupReadStorage,
  userId: string,
  notif: Pick<UserNotification, "id" | "referenceType" | "referenceId">,
): Promise<number> {
  await storage.markUserNotificationRead(notif.id, userId);
  if (!notif.referenceType || !notif.referenceId) return 0;
  const total = await storage.markUserNotificationsByReferenceRead(
    userId,
    notif.referenceType,
    notif.referenceId,
  );
  return total;
}
