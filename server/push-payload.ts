export interface PushPayloadInput {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  // Human-readable label for the underlying resource (e.g. "Ticket: Login
  // broken", "your conversation with Sam", "Cloud API"). The service worker
  // uses this to craft a coalesced rollup body when more than one unread
  // notification already exists for the same `tag` — avoiding hardcoded
  // resource names inside sw.js.
  resourceLabel?: string;
  // Plural noun describing what is rolling up (e.g. "replies", "messages",
  // "updates", "stories"). Combined with resourceLabel by the SW into
  // "N new <rollupNoun> on <resourceLabel>". Defaults to "updates" if
  // omitted.
  rollupNoun?: string;
}

export interface PushPayloadOptions {
  notificationId?: string | null;
}

export interface PushAction {
  action: string;
  title: string;
}

export interface PushPayloadOutput extends PushPayloadInput {
  actions?: PushAction[];
  notificationId?: string;
}

/**
 * Build the JSON payload sent to the browser via web-push. When a
 * `notificationId` (id of the persisted `user_notifications` row) is
 * supplied, we attach a "Mark as read" action so the recipient can
 * dismiss the notification straight from the OS toast — the service
 * worker turns that action into a PATCH /api/notifications/:id/read
 * call which clears the in-app bell badge and any related per-area
 * badge.
 */
export function buildPushPayload(
  payload: PushPayloadInput,
  opts: PushPayloadOptions = {},
): PushPayloadOutput {
  const out: PushPayloadOutput = { ...payload };
  if (opts.notificationId) {
    out.notificationId = opts.notificationId;
    out.actions = [{ action: "mark-read", title: "Mark as read" }];
  }
  return out;
}
