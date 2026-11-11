export type AnalyticsEvent =
  | "support_ticket_created"
  | "support_ticket_closed"
  | "support_message_sent"
  | "private_conversation_started"
  | "private_message_sent"
  | "service_alert_viewed"
  | "knowledge_article_viewed"
  | "knowledge_feedback_submitted"
  | "attachment_viewer_opened"
  | "attachment_download_requested"
  | "attachment_shared";

export type AnalyticsData = {
  actor_type?: "staff" | "customer";
  has_attachment?: boolean;
  internal?: boolean;
  helpful?: boolean;
  attachment_kind?: "image" | "video" | "file";
  message_channel?: "support" | "private";
};

declare global {
  interface Window {
    umami?: { track(name: string, data?: Record<string, string | number | boolean>): void | Promise<unknown> };
  }
}

/** Explicitly allow only low-cardinality dimensions, never user text or identifiers. */
function safeData(data: AnalyticsData = {}) {
  const result: Record<string, string | boolean> = {};
  if (data.actor_type === "staff" || data.actor_type === "customer") result.actor_type = data.actor_type;
  if (data.attachment_kind === "image" || data.attachment_kind === "video" || data.attachment_kind === "file") result.attachment_kind = data.attachment_kind;
  if (data.message_channel === "support" || data.message_channel === "private") result.message_channel = data.message_channel;
  for (const key of ["has_attachment", "internal", "helpful"] as const) {
    if (typeof data[key] === "boolean") result[key] = data[key];
  }
  return result;
}

export function trackEvent(name: AnalyticsEvent, data?: AnalyticsData): void {
  if (typeof window === "undefined") return;
  try {
    // The publishing proxy owns the tracker; do not add scripts or queue private actions.
    const result = window.umami?.track(name, safeData(data));
    if (result && typeof result.catch === "function") void result.catch(() => {});
  } catch {
    // Analytics must never affect messaging, downloads or navigation.
  }
}

const recentOutcomes = new Set<string>();

/** Local identifiers prevent retry double-counting but are never sent to analytics or persisted. */
export function trackOutcome(name: AnalyticsEvent, localKey: string | undefined, data?: AnalyticsData): void {
  if (!localKey || typeof window === "undefined") return;
  try {
    if (!window.umami) return;
    const key = `${name}:${localKey}`;
    if (recentOutcomes.has(key)) return;
    recentOutcomes.add(key);
    if (recentOutcomes.size > 500) recentOutcomes.delete(recentOutcomes.values().next().value!);
    trackEvent(name, data);
  } catch {
    // An unavailable tracker must never turn a successful action into an error.
  }
}
