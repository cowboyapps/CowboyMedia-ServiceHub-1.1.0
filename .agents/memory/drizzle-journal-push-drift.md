---
name: Drizzle journal vs db:push drift (boot migration collision)
description: Post-merge db:push adds columns without journaling; next boot's migrator replays the SQL and crashes with "column already exists". How to reconcile without data loss.
---

# Symptom

App fails to boot with a migrator error like:
`column "<x>" of relation "<table>" already exists` (Postgres code `42701`),
thrown from `server/migrate.ts` → drizzle `migrate()` at startup.

# Root cause

The post-merge setup step runs `drizzle-kit push` (db:push), which applies
schema columns from `shared/schema.ts` **directly to the DB but does NOT write
the drizzle migration journal** (`drizzle.__drizzle_migrations`). On the next
boot, `server/migrate.ts` runs the **migrator** (`drizzle migrate`), which still
thinks the latest migration file is unapplied and replays its `ALTER TABLE ADD
COLUMN ...` — colliding with the column push already created.

Drizzle's migrator decides what to run by comparing the **latest journal
`created_at`** against each migration's timestamp (`folderMillis`/`when`), not by
diffing the DB. So any migration whose `when` > last journaled `created_at` gets
replayed, even if its columns already exist.

# Fix (no data loss — preferred)

Insert the exact row drizzle itself would have written for the un-applied
migration, so the migrator skips it:

- `hash` = **sha256 of the migration `.sql` file content** (drizzle's hash scheme;
  verify by matching existing journal rows to `sha256sum migrations/*.sql`).
- `created_at` = that migration's **`when`** value from
  `migrations/meta/_journal.json`.

```sql
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
VALUES ('<sha256 of NNNN_*.sql>', <when-from-_journal.json>);
```

Then restart. The migrator sees latest `created_at` >= that migration's `when`
and skips it. `id` is serial — omit it.

# Don't

- **Don't drop the column** to let the migration re-add it — loses data and
  breaks for multi-statement migrations where the other statements already ran.
- Don't hand-edit committed migration SQL (changes its hash → breaks prod).

# Scope

This is **local/dev-only** drift caused by db:push in post-merge setup. Prod
deploys via `deploy/update.sh` and only ever runs the migrator (never push), so
prod's DB stays consistent with its journal and applies the same migrations
cleanly. Do NOT "fix" prod for this.
