CREATE TABLE "community_chat_pins" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"message_id" varchar NOT NULL,
	"pinned_by" varchar NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community_chat_pins" ADD CONSTRAINT "community_chat_pins_message_id_community_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."community_messages"("id") ON DELETE cascade ON UPDATE no action;