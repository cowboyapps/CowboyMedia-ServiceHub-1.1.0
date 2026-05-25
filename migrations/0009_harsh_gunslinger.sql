CREATE INDEX "alert_updates_alert_id_created_at_idx" ON "alert_updates" USING btree ("alert_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "kb_articles_category_id_idx" ON "kb_articles" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "monitor_incidents_monitor_id_started_at_idx" ON "monitor_incidents" USING btree ("monitor_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "news_stories_created_at_idx" ON "news_stories" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_alerts_created_at_idx" ON "service_alerts" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_alerts_service_id_idx" ON "service_alerts" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "tickets_customer_id_idx" ON "tickets" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "tickets_claimed_by_idx" ON "tickets" USING btree ("claimed_by");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");