-- Remove SLA tracking columns from ticket_categories and tickets.
ALTER TABLE ticket_categories DROP COLUMN IF EXISTS first_response_target_minutes;
ALTER TABLE ticket_categories DROP COLUMN IF EXISTS resolution_target_minutes;
ALTER TABLE tickets DROP COLUMN IF EXISTS first_response_at;
