---
name: notification_templates.enabled semantics
description: What the `enabled` flag on editable WHMCS notification wording actually controls
---

The `enabled` column on the `notification_templates` table (editable WHMCS push/in-app
notification wording, admin-edited in Admin Portal → Notification Wording) means
**"use the admin's custom wording"** — it does NOT gate whether the notification sends.

**Why:** these are transactional billing notifications (service suspended/reactivated/
renewing, invoice due-soon/overdue, billing ticket reply). Suppressing them entirely
would hide important account events from customers, so the toggle was scoped to wording
only. When `enabled === false` the renderer falls back to the built-in default title/body
and the notification still fires.

**How to apply:** the fallback lives in `renderNotification` in
`shared/notification-templates.ts` — override applies only when `enabled !== false` AND the
field is non-empty (per-field fallback). Defaults are the single source of truth in
`NOTIFICATION_TEMPLATE_DEFS`; the legacy pure copy helpers (`shared/whmcs-*-notify.ts`)
delegate to the same render path so there is no default-string drift. If you ever want a
real "don't send" switch, that's a separate flag — don't overload `enabled`.
