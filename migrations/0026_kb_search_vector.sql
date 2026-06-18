-- Knowledge Base full-text search support for kb_articles.
--
-- The `search_vector` tsvector column, its maintaining trigger, and the GIN
-- index were historically applied out of band (db:push / manual on prod) and
-- were never part of shared/schema.ts or migrations/. A freshly migrated or
-- drifted DB could end up with the trigger but no column, which made EVERY
-- insert/update on kb_articles fail with Postgres 42703
-- (`record "new" has no field "search_vector"`).
--
-- This migration makes KB search work out of the box on a fresh `db:migrate`.
-- Every statement is idempotent so it is safe to run on a DB that already had
-- these objects created out of band.

ALTER TABLE "kb_articles" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kb_articles_update_search_vector() RETURNS trigger AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'::text[]), ' ')), 'B') ||
    setweight(to_tsvector('english', regexp_replace(coalesce(NEW.body_html, ''), '<[^>]*>', ' ', 'g')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS kb_articles_search_vector_trigger ON "kb_articles";
--> statement-breakpoint
CREATE TRIGGER kb_articles_search_vector_trigger
  BEFORE INSERT OR UPDATE ON "kb_articles"
  FOR EACH ROW EXECUTE FUNCTION kb_articles_update_search_vector();
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "kb_articles_search_vector_idx" ON "kb_articles" USING gin ("search_vector");
--> statement-breakpoint
-- Backfill the vector for any rows that pre-date the trigger. The trigger only
-- fires on future writes, so existing articles would otherwise have a NULL
-- search_vector and never appear in search results until next edited.
UPDATE "kb_articles" SET "search_vector" =
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'::text[]), ' ')), 'B') ||
    setweight(to_tsvector('english', regexp_replace(coalesce(body_html, ''), '<[^>]*>', ' ', 'g')), 'C')
  WHERE "search_vector" IS NULL;
