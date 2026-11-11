CREATE OR REPLACE FUNCTION track_ticket_communication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed_automatically boolean;
BEGIN
  IF NEW.is_internal = false THEN
    SELECT status = 'closed' AND closure_reason = 'inactivity' INTO closed_automatically FROM tickets WHERE id = NEW.ticket_id FOR UPDATE;
    IF closed_automatically AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.sender_id AND username = 'cowboymedia-support'
    ) THEN
      RAISE EXCEPTION 'This ticket is closed. Please open a new ticket.' USING ERRCODE = '23514', CONSTRAINT = 'ticket_closed_reply';
    END IF;
    UPDATE tickets SET last_communication_at = GREATEST(last_communication_at, clock_timestamp()) WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$;
