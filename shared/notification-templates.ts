// Single source of truth for the WORDING of every WHMCS push / in-app
// notification, plus the variable metadata the admin editor renders.
//
// Why this module exists: the customer-facing copy for the three WHMCS
// background notifiers (service lifecycle, invoice due/overdue, billing-ticket
// reply) used to be hard-coded in the pure copy helpers (shared/whmcs-*-
// notify.ts) and in server/index.ts. To let admins edit that wording from the
// Admin Portal we centralise the DEFAULT strings + the list of `{placeholders}`
// each one understands here, and have the old copy helpers delegate to
// `renderNotification` so their output is byte-identical when no override is
// supplied. The notifiers pass an optional DB override (the admin's edited
// title/body) into the same render path, so an edit actually changes the
// delivered text while a missing/disabled override falls back to the default.
//
// This file is framework-free and server-free: it is imported by the shared
// pure helpers, by the server notifier wiring, and by the client admin tab.

export type NotificationTemplateKey =
  | "whmcs.service.renewal"
  | "whmcs.service.suspended"
  | "whmcs.service.unsuspended"
  | "whmcs.service.ready"
  | "whmcs.invoice.due_soon"
  | "whmcs.invoice.overdue"
  | "whmcs.ticket.reply";

/** Logical grouping for the admin UI. */
export type NotificationTemplateGroup = "Service" | "Invoice" | "Ticket";

export interface NotificationVariable {
  /** Placeholder name as it appears between braces, e.g. `service`. */
  name: string;
  /** Human description shown in the editor. */
  description: string;
}

export interface NotificationTemplateDef {
  key: NotificationTemplateKey;
  group: NotificationTemplateGroup;
  /** Short human label for the list/editor. */
  label: string;
  /** One-line explanation of when this notification fires. */
  description: string;
  /** Default title (may contain `{placeholders}`). */
  defaultTitle: string;
  /** Default body (may contain `{placeholders}`). */
  defaultBody: string;
  /** Placeholders this template understands. */
  variables: NotificationVariable[];
}

const SERVICE_VAR: NotificationVariable = {
  name: "service",
  description: "The service name (e.g. Web Hosting (example.com))",
};
const WHEN_RENEW_VAR: NotificationVariable = {
  name: "when",
  description: "Timing phrase, e.g. renews today / renews in 3 days",
};
const INVOICE_VAR: NotificationVariable = {
  name: "invoice",
  description: "The invoice number, e.g. #1234",
};
const AMOUNT_VAR: NotificationVariable = {
  name: "amount",
  description: "The amount due, e.g. 10.00 USD (blank when unknown)",
};
const WHEN_DUE_VAR: NotificationVariable = {
  name: "when",
  description: "Timing phrase, e.g. is due in 3 days / is overdue",
};
const SUBJECT_VAR: NotificationVariable = {
  name: "subject",
  description: "The ticket subject",
};

/**
 * Catalog of every editable WHMCS notification. The default strings here are
 * the canonical copy — the legacy pure helpers delegate to these so there is no
 * drift, and the DB rows are seeded from them.
 */
export const NOTIFICATION_TEMPLATE_DEFS: NotificationTemplateDef[] = [
  {
    key: "whmcs.service.renewal",
    group: "Service",
    label: "Service renews soon",
    description: "Sent as one of a customer's active services nears its renewal date.",
    defaultTitle: "Service renews soon",
    defaultBody: "Your service {service} {when}.",
    variables: [SERVICE_VAR, WHEN_RENEW_VAR],
  },
  {
    key: "whmcs.service.suspended",
    group: "Service",
    label: "Service suspended",
    description: "Sent when one of a customer's services is suspended.",
    defaultTitle: "Service suspended",
    defaultBody: "Your service {service} has been suspended.",
    variables: [SERVICE_VAR],
  },
  {
    key: "whmcs.service.unsuspended",
    group: "Service",
    label: "Service reactivated",
    description: "Sent when a suspended service is reactivated (unsuspended).",
    defaultTitle: "Service reactivated",
    defaultBody: "Your service {service} is active again.",
    variables: [SERVICE_VAR],
  },
  {
    key: "whmcs.service.ready",
    group: "Service",
    label: "New service is ready",
    description: "Sent once when a newly ordered service has finished provisioning and is ready to use.",
    defaultTitle: "Your new service is ready",
    defaultBody: "{service} is ready — tap to view your login details.",
    variables: [SERVICE_VAR],
  },
  {
    key: "whmcs.invoice.due_soon",
    group: "Invoice",
    label: "Invoice due soon",
    description: "Sent as one of a customer's unpaid invoices nears its due date.",
    defaultTitle: "Invoice due soon",
    defaultBody: "Invoice {invoice} ({amount}) {when}.",
    variables: [INVOICE_VAR, AMOUNT_VAR, WHEN_DUE_VAR],
  },
  {
    key: "whmcs.invoice.overdue",
    group: "Invoice",
    label: "Invoice overdue",
    description: "Sent once one of a customer's unpaid invoices becomes overdue.",
    defaultTitle: "Invoice overdue",
    defaultBody: "Invoice {invoice} ({amount}) {when}.",
    variables: [INVOICE_VAR, AMOUNT_VAR, WHEN_DUE_VAR],
  },
  {
    key: "whmcs.ticket.reply",
    group: "Ticket",
    label: "Billing ticket reply",
    description: "Sent when staff reply to one of a customer's WHMCS billing tickets.",
    defaultTitle: "New Billing Ticket Reply",
    defaultBody: "Reply on: {subject}",
    variables: [SUBJECT_VAR],
  },
];

const DEFS_BY_KEY: Record<NotificationTemplateKey, NotificationTemplateDef> =
  Object.fromEntries(NOTIFICATION_TEMPLATE_DEFS.map((d) => [d.key, d])) as Record<
    NotificationTemplateKey,
    NotificationTemplateDef
  >;

export function getNotificationTemplateDef(
  key: NotificationTemplateKey,
): NotificationTemplateDef {
  return DEFS_BY_KEY[key];
}

/** Editable fields an admin can override (shape of the persisted DB row). */
export interface NotificationTemplateOverride {
  title?: string | null;
  body?: string | null;
  enabled?: boolean | null;
}

/** Replace `{name}` tokens with values; unknown tokens are left untouched. */
export function interpolateNotification(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined ? match : vars[key],
  );
}

/**
 * Normalise a rendered string: drop empty `()` (left over when an optional
 * value such as the invoice amount is blank), collapse runs of whitespace, and
 * remove a space that ends up sitting before punctuation. Keeps the default
 * invoice body reading naturally whether or not an amount is known.
 */
export function tidyNotification(s: string): string {
  return s
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .trim();
}

/**
 * Render the final {title, body} for a notification. When `override` is present
 * AND enabled (enabled !== false) its non-empty title/body win; otherwise the
 * built-in defaults are used. Both paths interpolate `vars` and tidy the result,
 * so a default with a blank amount and an admin's custom wording are handled the
 * same way.
 */
export function renderNotification(
  key: NotificationTemplateKey,
  vars: Record<string, string>,
  override?: NotificationTemplateOverride | null,
): { title: string; body: string } {
  const def = DEFS_BY_KEY[key];
  const active = !!override && override.enabled !== false;
  const titleStr = active && override?.title ? override.title : def.defaultTitle;
  const bodyStr = active && override?.body ? override.body : def.defaultBody;
  return {
    title: tidyNotification(interpolateNotification(titleStr, vars)),
    body: tidyNotification(interpolateNotification(bodyStr, vars)),
  };
}
