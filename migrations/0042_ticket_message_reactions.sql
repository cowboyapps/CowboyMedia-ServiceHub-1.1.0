CREATE TABLE "ticket_message_reactions" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "message_id" varchar NOT NULL,
  "user_id" varchar NOT NULL,
  "emoji" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ticket_message_reactions" ADD CONSTRAINT "ticket_message_reactions_message_id_ticket_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."ticket_messages"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "ticket_message_reactions" ADD CONSTRAINT "ticket_message_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_message_reactions_message_user_idx" ON "ticket_message_reactions" USING btree ("message_id","user_id");
