-- TOTP-based 2FA for admin users.
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_secret text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS totp_enabled_at timestamp;

CREATE TABLE IF NOT EXISTS totp_backup_codes (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL,
  code_hash text NOT NULL,
  used_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS totp_backup_codes_user_id_idx ON totp_backup_codes(user_id);
