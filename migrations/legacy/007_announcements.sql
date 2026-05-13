CREATE TABLE IF NOT EXISTS announcements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body_html TEXT NOT NULL,
  link_path TEXT,
  link_label TEXT,
  frequency TEXT NOT NULL DEFAULT 'once',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id VARCHAR NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_announcements_active_created_at
  ON announcements (active, created_at DESC);

CREATE TABLE IF NOT EXISTS announcement_dismissals (
  announcement_id VARCHAR NOT NULL,
  user_id VARCHAR NOT NULL,
  dismissed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  PRIMARY KEY (announcement_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user
  ON announcement_dismissals (user_id);
