-- Manual cleanup for the removed postmortem feature.
--
-- This file is intentionally NOT executed by migrations/run.sh or
-- deploy/update.sh. Run it by hand during a maintenance window once
-- you are sure no rolling deploy needs the columns/table anymore.
--
-- It drops:
--   * the three postmortem_* columns on service_alerts
--   * the public_status_subscribers table (legacy global postmortem
--     mailing list — per-service follows live in service_subscribers)
--   * the customer_alert_postmortem row from email_templates
--
-- After running this, you can also remove the matching field
-- definitions from shared/schema.ts (serviceAlerts.postmortemHtml,
-- postmortemPublishedAt, postmortemAuthorId, the publicStatusSubscribers
-- table) and the storage helpers in server/storage.ts.

BEGIN;

ALTER TABLE service_alerts
  DROP COLUMN IF EXISTS postmortem_html,
  DROP COLUMN IF EXISTS postmortem_published_at,
  DROP COLUMN IF EXISTS postmortem_author_id;

DROP TABLE IF EXISTS public_status_subscribers;

DELETE FROM email_templates WHERE template_key = 'customer_alert_postmortem';

COMMIT;
