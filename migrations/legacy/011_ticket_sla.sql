-- Ticket SLA tracking: per-category targets and per-ticket first-response timestamp.
ALTER TABLE ticket_categories
  ADD COLUMN IF NOT EXISTS first_response_target_minutes integer,
  ADD COLUMN IF NOT EXISTS resolution_target_minutes integer;

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS first_response_at timestamp;

-- Backfill first_response_at from the earliest non-system admin message per ticket.
UPDATE tickets t
SET first_response_at = sub.first_admin_at
FROM (
  SELECT tm.ticket_id, MIN(tm.created_at) AS first_admin_at
  FROM ticket_messages tm
  JOIN users u ON u.id = tm.sender_id
  WHERE (u.role = 'admin' OR u.role = 'master_admin')
    AND u.username <> 'cowboymedia-support'
  GROUP BY tm.ticket_id
) sub
WHERE t.id = sub.ticket_id AND t.first_response_at IS NULL;
