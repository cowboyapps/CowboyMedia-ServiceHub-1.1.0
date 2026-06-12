CREATE TABLE "notification_templates" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" varchar NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"customized" boolean DEFAULT false NOT NULL,
	CONSTRAINT "notification_templates_template_key_unique" UNIQUE("template_key")
);
