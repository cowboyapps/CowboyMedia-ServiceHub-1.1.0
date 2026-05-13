CREATE TABLE IF NOT EXISTS business_hours (
  id VARCHAR PRIMARY KEY DEFAULT 'singleton',
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  days_of_week INTEGER[] NOT NULL DEFAULT '{1,2,3,4,5}',
  start_time TEXT NOT NULL DEFAULT '09:00',
  end_time TEXT NOT NULL DEFAULT '17:00',
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  after_hours_message TEXT NOT NULL DEFAULT 'Our support team is currently outside of business hours. You can still submit a ticket and we''ll respond as soon as we''re back.',
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO business_hours (id) VALUES ('singleton')
  ON CONFLICT (id) DO NOTHING;
