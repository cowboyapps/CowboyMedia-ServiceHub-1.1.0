CREATE TABLE "whmcs_settings" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"base_url" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"auto_match_by_email" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whmcs_client_id" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whmcs_linked_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "users_whmcs_client_id_idx" ON "users" USING btree ("whmcs_client_id");