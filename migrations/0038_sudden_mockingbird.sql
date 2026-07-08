CREATE TABLE "community_message_edits" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" varchar NOT NULL,
	"previous_content" text NOT NULL,
	"edited_by" varchar NOT NULL,
	"edited_by_username" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "community_message_edits_message_id_idx" ON "community_message_edits" USING btree ("message_id");