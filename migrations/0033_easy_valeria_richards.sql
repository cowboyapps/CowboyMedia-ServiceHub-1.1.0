CREATE TABLE "whmcs_service_announcements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"whmcs_service_id" integer NOT NULL,
	"service_name" text NOT NULL,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whmcs_service_baselines" (
	"user_id" varchar PRIMARY KEY NOT NULL,
	"baselined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "whmcs_service_announcements_user_service_uniq" ON "whmcs_service_announcements" USING btree ("user_id","whmcs_service_id");--> statement-breakpoint
CREATE INDEX "whmcs_service_announcements_user_id_idx" ON "whmcs_service_announcements" USING btree ("user_id");