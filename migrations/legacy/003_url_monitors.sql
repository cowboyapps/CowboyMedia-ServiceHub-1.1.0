CREATE TABLE IF NOT EXISTS url_monitors (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  monitor_type TEXT NOT NULL DEFAULT 'url_availability',
  check_interval_seconds INTEGER NOT NULL DEFAULT 60,
  expected_status_code INTEGER NOT NULL DEFAULT 200,
  timeout_seconds INTEGER NOT NULL DEFAULT 10,
  consecutive_failures_threshold INTEGER NOT NULL DEFAULT 3,
  email_notifications BOOLEAN NOT NULL DEFAULT true,
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_checked_at TIMESTAMP,
  last_status_change TIMESTAMP,
  last_response_time_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

ALTER TABLE url_monitors ADD COLUMN IF NOT EXISTS monitor_type TEXT NOT NULL DEFAULT 'url_availability';

CREATE TABLE IF NOT EXISTS monitor_incidents (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  monitor_id VARCHAR NOT NULL,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  duration_seconds INTEGER,
  failure_reason TEXT,
  notified_down BOOLEAN NOT NULL DEFAULT false,
  notified_up BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_monitor_incidents_monitor_id ON monitor_incidents(monitor_id);
