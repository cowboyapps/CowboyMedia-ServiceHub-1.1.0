ALTER TABLE "thread_messages" ADD COLUMN "edited_at" timestamp;
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "client_message_id" varchar;
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "request_fingerprint" text;
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "attachment_name" text;
--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "attachment_type" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "thread_messages_client_message_idx" ON "thread_messages" USING btree ("thread_id", "sender_id", "client_message_id");
--> statement-breakpoint
CREATE TABLE "thread_message_reactions" (
  "message_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "thread_message_reactions" ADD CONSTRAINT "thread_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "public"."thread_messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "thread_message_reactions_message_user_idx" ON "thread_message_reactions" USING btree ("message_id", "user_id");
