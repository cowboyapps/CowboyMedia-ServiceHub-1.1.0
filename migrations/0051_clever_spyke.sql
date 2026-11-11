ALTER TABLE "tickets" ADD COLUMN "auto_close_hold_reason" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "auto_close_hold_until" timestamp;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "auto_close_hold_by" varchar;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "auto_close_hold_at" timestamp;