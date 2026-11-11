CREATE TABLE "ticket_reminder_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" varchar NOT NULL,
	"activity_at" timestamp NOT NULL,
	"channel" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text DEFAULT 'attempted' NOT NULL,
	"detail" text DEFAULT 'Send claimed; outcome unknown. Not retried automatically.' NOT NULL,
	"retryable" boolean DEFAULT false NOT NULL,
	"attempted_at" timestamp DEFAULT now() NOT NULL,
	"finished_at" timestamp,
	"retry_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_reminder_attempt_cycle_idx" ON "ticket_reminder_attempts" USING btree ("ticket_id","activity_at","channel","attempt");
--> statement-breakpoint
-- Old claims may already have reached a provider. Preserve their uncertainty.
INSERT INTO "ticket_reminder_attempts" ("ticket_id", "activity_at", "channel", "attempt", "status", "detail")
SELECT id, inactivity_reminder_push_activity, 'push', 1, 'attempted',
  'Legacy send claimed; provider outcome was not recorded. Not retried to prevent duplicates.'
FROM tickets WHERE inactivity_reminder_push_activity IS NOT NULL
UNION ALL
SELECT id, inactivity_reminder_email_activity, 'email', 1, 'attempted',
  'Legacy send claimed; provider outcome was not recorded. Not retried to prevent duplicates.'
FROM tickets WHERE inactivity_reminder_email_activity IS NOT NULL;