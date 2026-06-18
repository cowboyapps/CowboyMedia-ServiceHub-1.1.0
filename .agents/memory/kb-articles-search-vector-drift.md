---
name: kb_articles search_vector lives outside migrations
description: Why kb_articles inserts can fail in a dev DB, and how the full-text search column/trigger are managed.
---

`kb_articles` has a `search_vector tsvector` column + a BEFORE INSERT/UPDATE trigger
(`kb_articles_search_vector_trigger` → `kb_articles_update_search_vector()`) that
builds it from title/summary/tags/body_html. `server/storage.ts` queries it via raw
SQL (`WHERE search_vector @@ plainto_tsquery(...)`).

**None of this is in `migrations/` or `shared/schema.ts`** — it's managed out of band
(db:push / manual on prod).

**Why it bites:** a drifted dev DB can end up with the *trigger but not the column*.
Then ANY insert into `kb_articles` fails with `record "new" has no field "search_vector"`
(Postgres 42703). Repair the local DB (does not belong in migrations):
```sql
ALTER TABLE kb_articles ADD COLUMN IF NOT EXISTS search_vector tsvector;
UPDATE kb_articles SET search_vector = setweight(to_tsvector('english',coalesce(title,'')),'A')
  || setweight(to_tsvector('english',coalesce(summary,'')),'B')
  || setweight(to_tsvector('english',array_to_string(coalesce(tags,'{}'::text[]),' ')),'B')
  || setweight(to_tsvector('english',regexp_replace(coalesce(body_html,''),'<[^>]*>',' ','g')),'C');
CREATE INDEX IF NOT EXISTS kb_articles_search_vector_idx ON kb_articles USING gin(search_vector);
```

**How to apply:** if you write a DB-backed test (or any code) that inserts into
`kb_articles` and hit the 42703 error, repair the local DB column as above — don't add
search_vector to schema.ts/migrations, and don't drop the trigger.
