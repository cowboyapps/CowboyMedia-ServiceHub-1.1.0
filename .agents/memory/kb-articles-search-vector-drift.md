---
name: kb_articles search_vector full-text search
description: How the kb_articles full-text search column/trigger/index are managed (now via a committed migration).
---

`kb_articles` has a `search_vector tsvector` column + a BEFORE INSERT/UPDATE trigger
(`kb_articles_search_vector_trigger` → `kb_articles_update_search_vector()`) that
builds it from title/summary/tags/body_html. `server/storage.ts` queries it via raw
SQL (`WHERE search_vector @@ plainto_tsquery(...)`).

**This is now created by a committed migration** (`migrations/0026_kb_search_vector.sql`),
so a fresh `npm run db:migrate` yields a working KB search out of the box. Every
statement in that migration is idempotent (`ADD COLUMN IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + recreate,
`CREATE INDEX IF NOT EXISTS`) so it is safe on a DB that already had these objects
created out of band, and it also repairs the old "trigger but no column" drift.

**Still NOT in `shared/schema.ts`** — drizzle's type system doesn't model `tsvector`
well, so the column is managed via raw SQL/migration and excluded from the column
drift check via `KNOWN_UNDECLARED_COLUMNS` in `script/audit-columns.ts`. Do not add
it to schema.ts (that would make `drizzle-kit generate` try to manage it) and do not
remove the audit exclusion (the audit would then flag it as an extra column).

**Historical bite (pre-migration):** a drifted dev DB could end up with the
*trigger but not the column*. Then ANY insert into `kb_articles` failed with
`record "new" has no field "search_vector"` (Postgres 42703).

**If the drift recurs even though 0026 exists:** `npm run db:migrate` will report
"migrations up to date" and NOT fix it — the journal already records 0026 as
applied, so the drizzle migrator skips it while the column is still missing (the
journal-vs-actual drift class). Apply the idempotent repair by hand instead:
`psql "$DATABASE_URL" -f <(sed 's/--> statement-breakpoint//g' migrations/0026_kb_search_vector.sql)`.
It only `ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE` / recreates the trigger,
so it is safe to re-run. Symptom in the test suite: every `kb_articles` insert
(kb-search.test.ts, uploaded-file-cleanup.test.ts) fails with the 42703 message.
