CREATE TABLE "app_settings" (
	"id" varchar PRIMARY KEY DEFAULT 'singleton' NOT NULL,
	"auto_deploy_enabled" boolean DEFAULT true NOT NULL,
	"auto_deploy_paused_reason" text,
	"auto_deploy_paused_by" varchar,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
