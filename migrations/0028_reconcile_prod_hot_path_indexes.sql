-- Reconcile prod hot-path indexes.
--
-- These 9 indexes are declared in 0000_baseline.sql (and were also built by the
-- pre-drizzle hand-written SQL in migrations/legacy/017_hot_path_indexes.sql,
-- which used concurrent builds). On production they are MISSING: a concurrent
-- build aborts inside the drizzle migrator's transaction, and 0000_baseline was
-- baselined against the pre-existing prod DB so its index statements never ran
-- either. The db:check:columns gate therefore flags all 9 as MISSING and blocks
-- the deploy.
--
-- This migration recreates them idempotently and non-concurrently (the drizzle
-- migrator runs each migration inside a transaction, which is exactly why the
-- legacy concurrent version never applied). On any environment that already has
-- them (e.g. dev, built from 0000) every statement is a no-op. Definitions are
-- copied verbatim from 0000_baseline.sql so normalizeIndexDef sees an identical
-- canonical form and the index-drift audit stays green everywhere.
--
-- NOTE: do not write the literal token sequence for a concurrent index build in
-- this file's comments -- the audit's migration parser scans raw SQL text and
-- would capture it as a phantom index name.
CREATE INDEX IF NOT EXISTS "admin_chat_messages_thread_id_created_at_idx" ON "admin_chat_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "content_notifications_user_category_read_idx" ON "content_notifications" USING btree ("user_id","category","read_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "report_notifications_user_id_unread_idx" ON "report_notifications" USING btree ("user_id") WHERE "report_notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "thread_messages_thread_id_created_at_idx" ON "thread_messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_messages_ticket_id_created_at_idx" ON "ticket_messages" USING btree ("ticket_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_notifications_user_id_unread_idx" ON "ticket_notifications" USING btree ("user_id") WHERE "ticket_notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_user_id_created_at_idx" ON "user_notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_notifications_user_id_unread_idx" ON "user_notifications" USING btree ("user_id") WHERE "user_notifications"."read_at" IS NULL AND "user_notifications"."dismissed_at" IS NULL;
