ALTER TABLE "app_settings" ADD COLUMN "ticket_auto_close_reminder_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "app_settings" ADD COLUMN "ticket_auto_close_reminder_hours_before" integer DEFAULT 12 NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "inactivity_reminder_in_app_activity" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "inactivity_reminder_push_activity" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "inactivity_reminder_email_activity" timestamp;