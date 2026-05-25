DROP INDEX "tickets_created_at_idx";--> statement-breakpoint
DROP INDEX "tickets_status_idx";--> statement-breakpoint
CREATE INDEX "tickets_status_created_at_idx" ON "tickets" USING btree ("status","created_at" DESC NULLS LAST);