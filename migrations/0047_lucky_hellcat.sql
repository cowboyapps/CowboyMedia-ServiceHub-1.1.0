ALTER TABLE "app_settings" ADD COLUMN "ticket_auto_close_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ticket_auto_close_days" integer DEFAULT 7 NOT NULL;
--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ticket_auto_close_message" text DEFAULT 'Ticket closed due to inactivity - You may open a new ticket should the need arise.' NOT NULL;
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "last_communication_at" timestamp DEFAULT now() NOT NULL;
--> statement-breakpoint
UPDATE tickets t SET last_communication_at = GREATEST(t.created_at, COALESCE(
  (SELECT max(m.created_at) FROM ticket_messages m WHERE m.ticket_id = t.id AND m.is_internal = false), t.created_at));
--> statement-breakpoint
CREATE FUNCTION track_ticket_communication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_status text;
BEGIN
  IF NEW.is_internal = false THEN
    SELECT status INTO current_status FROM tickets WHERE id = NEW.ticket_id FOR UPDATE;
    IF current_status = 'closed' AND NOT EXISTS (
      SELECT 1 FROM users WHERE id = NEW.sender_id AND username = 'cowboymedia-support'
    ) THEN
      RAISE EXCEPTION 'This ticket is closed. Please open a new ticket.' USING ERRCODE = '23514', CONSTRAINT = 'ticket_closed_reply';
    END IF;
    UPDATE tickets SET last_communication_at = GREATEST(last_communication_at, clock_timestamp()) WHERE id = NEW.ticket_id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_communication_insert BEFORE INSERT ON ticket_messages
FOR EACH ROW EXECUTE FUNCTION track_ticket_communication();
--> statement-breakpoint
CREATE FUNCTION reset_reopened_ticket_inactivity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' AND NEW.status <> 'closed' THEN
    NEW.last_communication_at = clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ticket_reopened_inactivity BEFORE UPDATE OF status ON tickets
FOR EACH ROW EXECUTE FUNCTION reset_reopened_ticket_inactivity();
