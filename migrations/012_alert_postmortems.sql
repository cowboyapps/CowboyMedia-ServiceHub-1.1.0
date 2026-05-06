ALTER TABLE service_alerts ADD COLUMN IF NOT EXISTS postmortem_html TEXT;
ALTER TABLE service_alerts ADD COLUMN IF NOT EXISTS postmortem_published_at TIMESTAMP;
ALTER TABLE service_alerts ADD COLUMN IF NOT EXISTS postmortem_author_id VARCHAR;
