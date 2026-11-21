ALTER TABLE "community_messages" ADD COLUMN "news_article_id" varchar;--> statement-breakpoint
ALTER TABLE "thread_messages" ADD COLUMN "news_article_id" varchar;--> statement-breakpoint
ALTER TABLE "ticket_messages" ADD COLUMN "news_article_id" varchar;