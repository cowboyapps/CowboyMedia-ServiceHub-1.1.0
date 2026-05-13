-- Internal admin-only notes on tickets.
ALTER TABLE ticket_messages
  ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
