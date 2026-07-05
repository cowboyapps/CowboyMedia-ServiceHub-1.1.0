export interface UserNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  url: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

export type GroupedNotification = {
  key: string;
  notifications: UserNotification[];
  latest: UserNotification;
  count: number;
};

// Reference types whose notifications should collapse into a single row when they
// share the same referenceId. These all represent one conversational/threaded
// object where every event is genuinely "more of the same thing" (ticket
// replies, DM messages, report status updates). Lifecycle reference types whose
// events carry distinct, independent meaning (e.g. "whmcs_service" fans out
// renewal / suspension / ready / added, "url_monitor" fans out down vs. up) are
// deliberately excluded so collapsing never hides one signal behind another.
export const GROUPABLE_REFERENCE_TYPES = new Set([
  "ticket",
  "whmcs_ticket",
  "message_thread",
  "private_message",
  "admin_chat_thread",
  "community_message",
  "report_request",
]);

// Collapse notifications that point at the same underlying object (all events for
// one ticket, all replies in one message thread, etc.) into a single row. Only
// allowlisted reference types collapse; anything without a reference — or a
// non-groupable reference type — stays its own standalone row. Groups (and the
// notifications within each) are ordered newest-first by createdAt.
export function groupNotifications(notifications: UserNotification[]): GroupedNotification[] {
  const groups: GroupedNotification[] = [];
  const refGroups = new Map<string, UserNotification[]>();

  for (const notif of notifications) {
    if (notif.referenceType && notif.referenceId && GROUPABLE_REFERENCE_TYPES.has(notif.referenceType)) {
      const key = `${notif.referenceType}-${notif.referenceId}`;
      if (!refGroups.has(key)) refGroups.set(key, []);
      refGroups.get(key)!.push(notif);
    } else {
      groups.push({ key: notif.id, notifications: [notif], latest: notif, count: 1 });
    }
  }

  for (const [key, notifs] of refGroups) {
    const sorted = notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    groups.push({ key, notifications: sorted, latest: sorted[0], count: sorted.length });
  }

  groups.sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
  return groups;
}
