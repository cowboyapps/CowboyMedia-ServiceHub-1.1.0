CREATE TABLE IF NOT EXISTS quick_response_categories (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE quick_responses ADD COLUMN IF NOT EXISTS category_id varchar;
ALTER TABLE quick_responses ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS quick_response_favorites (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id varchar NOT NULL,
  response_id varchar NOT NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (admin_id, response_id)
);

CREATE INDEX IF NOT EXISTS idx_quick_responses_category ON quick_responses(category_id);
CREATE INDEX IF NOT EXISTS idx_quick_response_favorites_admin ON quick_response_favorites(admin_id);
