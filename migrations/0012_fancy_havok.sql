CREATE TABLE "alert_services" (
	"alert_id" varchar NOT NULL,
	"service_id" varchar NOT NULL,
	CONSTRAINT "alert_services_alert_id_service_id_pk" PRIMARY KEY("alert_id","service_id")
);
--> statement-breakpoint
ALTER TABLE "service_alerts" ADD COLUMN "impact" text;--> statement-breakpoint
INSERT INTO "alert_services" ("alert_id", "service_id") SELECT "id", "service_id" FROM "service_alerts";--> statement-breakpoint
UPDATE "service_alerts" sa SET "impact" = s."status" FROM "services" s WHERE sa."service_id" = s."id" AND sa."status" <> 'resolved';--> statement-breakpoint
DROP INDEX "service_alerts_service_id_idx";--> statement-breakpoint
CREATE INDEX "alert_services_service_id_idx" ON "alert_services" USING btree ("service_id");--> statement-breakpoint
ALTER TABLE "service_alerts" DROP COLUMN "service_id";