CREATE TABLE "changelog_entries" (
	"version" varchar PRIMARY KEY NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body_html" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_at" timestamp,
	"published_by" varchar,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
