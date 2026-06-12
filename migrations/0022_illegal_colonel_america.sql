CREATE TABLE "whmcs_link_verifications" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"whmcs_client_id" integer NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "whmcs_link_prompt_dismissed_at" timestamp;--> statement-breakpoint
CREATE INDEX "whmcs_link_verifications_user_id_idx" ON "whmcs_link_verifications" USING btree ("user_id");