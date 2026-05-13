-- Public status page: link monitors to services and add public email subscribers.

ALTER TABLE url_monitors ADD COLUMN IF NOT EXISTS service_id varchar;

CREATE TABLE IF NOT EXISTS service_subscribers (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id varchar NOT NULL,
  email text NOT NULL,
  events text[] NOT NULL DEFAULT '{}'::text[],
  unsubscribe_token varchar NOT NULL UNIQUE,
  confirmed_at timestamp,
  created_at timestamp NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_subscribers_service ON service_subscribers(service_id);
CREATE INDEX IF NOT EXISTS idx_service_subscribers_email_service ON service_subscribers(email, service_id);
