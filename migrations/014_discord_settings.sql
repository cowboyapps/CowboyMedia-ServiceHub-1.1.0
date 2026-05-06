CREATE TABLE IF NOT EXISTS discord_settings (
  id varchar PRIMARY KEY DEFAULT 'singleton',
  webhook_url text,
  enabled boolean NOT NULL DEFAULT false,
  send_alerts boolean NOT NULL DEFAULT true,
  send_service_updates boolean NOT NULL DEFAULT true,
  send_news boolean NOT NULL DEFAULT true,
  updated_at timestamp NOT NULL DEFAULT now()
);

INSERT INTO discord_settings (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;
