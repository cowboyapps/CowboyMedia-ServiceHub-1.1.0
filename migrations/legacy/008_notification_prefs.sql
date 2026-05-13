-- Add per-type notification preferences as JSONB on users.
-- Empty object means "use defaults" (everything ON) per shared/notification-categories.ts.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Migrate the legacy global emailNotifications=false flag into per-category overrides:
-- for any customer-facing category, set email=false. Push values are left untouched (default ON).
-- Only applied to users who have not yet customized notification_prefs (i.e. still default '{}').
UPDATE users
SET notification_prefs = jsonb_build_object(
  'ticket_reply',       jsonb_build_object('email', false),
  'ticket_claimed',     jsonb_build_object('email', false),
  'ticket_transferred', jsonb_build_object('email', false),
  'ticket_received',    jsonb_build_object('email', false),
  'ticket_closed',      jsonb_build_object('email', false),
  'report_received',    jsonb_build_object('email', false),
  'report_update',      jsonb_build_object('email', false),
  'private_message',    jsonb_build_object('email', false),
  'thread_message',     jsonb_build_object('email', false),
  'service_status',     jsonb_build_object('email', false),
  'service_alert',      jsonb_build_object('email', false),
  'service_update',     jsonb_build_object('email', false),
  'news',               jsonb_build_object('email', false),
  'setup_reminder',     jsonb_build_object('email', false)
)
WHERE email_notifications = false
  AND (notification_prefs IS NULL OR notification_prefs = '{}'::jsonb);
