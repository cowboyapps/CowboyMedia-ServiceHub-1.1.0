CREATE TABLE "whmcs_ticket_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"whmcs_ticket_id" integer NOT NULL,
	"last_notified_reply" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whmcs_ticket_notifications_user_ticket_uniq" ON "whmcs_ticket_notifications" USING btree ("user_id","whmcs_ticket_id");