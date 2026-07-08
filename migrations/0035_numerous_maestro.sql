CREATE TABLE "alert_drafts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"monitor_id" varchar NOT NULL,
	"monitor_incident_id" varchar,
	"service_id" varchar,
	"kind" text NOT NULL,
	"suggested_title" text NOT NULL,
	"suggested_description" text NOT NULL,
	"suggested_severity" text DEFAULT 'critical' NOT NULL,
	"suggested_service_impact" text DEFAULT 'outage' NOT NULL,
	"related_alert_id" varchar,
	"status" text DEFAULT 'pending' NOT NULL,
	"acted_by_user_id" varchar,
	"acted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_drafts_monitor_id_idx" ON "alert_drafts" USING btree ("monitor_id");--> statement-breakpoint
CREATE INDEX "alert_drafts_status_idx" ON "alert_drafts" USING btree ("status");