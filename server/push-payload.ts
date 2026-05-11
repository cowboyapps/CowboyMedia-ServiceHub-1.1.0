export interface PushPayloadInput {
  title: string;
  body: string;
  url?: string;
  tag?: string;
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
