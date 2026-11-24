CREATE TABLE "telegram_import_settings" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"encrypted_session" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"channel_id" text,
	"channel_title" text,
	"last_message_id" integer DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp,
	"last_imported_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "telegram_service_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" text NOT NULL,
	"channel_title" text NOT NULL,
	"source_url" text,
	"source_message_id" integer NOT NULL,
	"source_posted_at" timestamp NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"service_id" varchar DEFAULT '' NOT NULL,
	"mature_content" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"published_update_id" varchar,
	"admin_notified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "telegram_drafts_source_message_idx" ON "telegram_service_drafts" USING btree ("channel_id","source_message_id");