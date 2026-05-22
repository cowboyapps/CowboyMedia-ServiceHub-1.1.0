CREATE TABLE "support_away_messages" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"message" text DEFAULT 'Our support team is away right now. We''ll be back shortly and will reply to your ticket as soon as we return.' NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"updated_by" varchar
);
