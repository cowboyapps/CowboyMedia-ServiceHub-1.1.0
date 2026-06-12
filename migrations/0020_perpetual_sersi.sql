CREATE TABLE "whmcs_service_notifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"whmcs_service_id" integer NOT NULL,
	"last_seen_status" text NOT NULL,
	"last_renewal_notified" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whmcs_service_notifications_user_service_uniq" ON "whmcs_service_notifications" USING btree ("user_id","whmcs_service_id");