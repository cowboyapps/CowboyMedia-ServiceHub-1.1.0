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

# Variant: dual-migration collision during rebase (renumber + full reconcile)

When a rebase brings in an upstream migration that took **your same index** (e.g.
both branches added `0016_*`), resolve by taking upstream's `migrations/meta/`
(`git checkout --ours` during rebase — HEAD/ours is the rebase base), `git rm`
your colliding `.sql`, then `npm run db:generate` to re-emit your change at the
next free index (e.g. `0017_*`). `db:check` must be clean before continuing.

The dev DB after this will have the **correct final schema** (post-merge push +
your earlier pre-rebase run both already added the column/table) but a
`__drizzle_migrations` table whose rows/timestamps no longer line up with the
renumbered journal — so boot replays your renumbered migration and hits 42701.
Because the schema is already correct, the cleanest fix is to **rebuild the whole
bookkeeping table from the journal** (not just insert one row): inside a txn,
`DELETE FROM drizzle.__drizzle_migrations`, then insert one `(hash, created_at)`
per `_journal.json` entry (hash = sha256 of each `migrations/<tag>.sql`,
created_at = its `when`). Restart → "migrations up to date". Prod is unaffected
(fresh DB applies upstream-0016 → your-0017 in order).

# Variant: push is PARTIAL — verify each unjournaled migration's effect in the DB before journaling it

db:push does not guarantee all pending migrations got applied. Seen in practice:
a `CREATE TABLE` migration (e.g. `whmcs_product_mappings`) was pushed (table
exists) but the *next* migration's `ADD COLUMN admin_username` was NOT. If you
blindly insert journal rows for **every** unjournaled migration, you mark the
ADD COLUMN as applied and the column never gets created — boot is green but the
app crashes at runtime with `column "x" does not exist`.

**Rule:** for each unjournaled migration, check whether its actual DDL effect
exists in the DB (`\d <table>`, `to_regclass('public.<table>')`) BEFORE inserting
its journal row. Journal only the ones already applied; leave the genuinely-missing
ones unjournaled so the migrator runs them on next boot. Confirm with
`SELECT migrationsApplied` in `/api/health` AND a direct `\d` column check.

# Scope

This is **local/dev-only** drift caused by db:push in post-merge setup. Prod
deploys via `deploy/update.sh` and only ever runs the migrator (never push), so
prod's DB stays consistent with its journal and applies the same migrations
cleanly. Do NOT "fix" prod for this.

# Root cause structurally removed in post-merge (keep the recovery above for legacy DBs)

`scripts/post-merge.sh` no longer calls `scripts/db-sync.sh` (`drizzle-kit push`).
It now runs the journaling migrator (`npm run db:migrate` → `runMigrations`), so a
table-adding merge applies + journals in lockstep and the next boot is a clean
no-op — the recurring `relation already exists` crash can no longer originate from
post-merge. Guarded by `test/post-merge-migrate-gate.test.ts`.
**Why:** push applies schema without writing `drizzle.__drizzle_migrations`; the
migrator does both, matching boot/prebuild/prod.
**Still watch:** `db:push` survives in the `.replit` deploy build step (`.replit`
`build = [... "bash scripts/db-sync.sh"]`), so the same drift can still appear via
a Replit Deployments build — use the journal-insert recovery above if it recurs there.
