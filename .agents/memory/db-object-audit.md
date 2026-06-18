---
name: DB trigger/function drift audit
description: Where out-of-band Postgres triggers/functions get caught and how to satisfy the gate.
---
The column audit (`script/audit-columns.ts`, run as `db:check:columns` in prebuild) also audits Postgres triggers and functions.

**The rule:** every user-defined trigger/function in the DB must be created by a committed `migrations/*.sql` file. Any object in the DB with no backing migration (or a migration object missing from the DB) fails the build (exit 1).

**Why:** drizzle's `shared/schema.ts` does not model triggers/functions, so they live only in raw-SQL migrations. The kb_articles search_vector trigger once lived fully out of band → a fresh migrate had the trigger but no column → every kb save threw Postgres 42703. Name-level drift detection catches the next such object before deploy.

**How to apply:** when adding a trigger/function, put idempotent DDL in a migration (model it on `migrations/0026_kb_search_vector.sql`). If an object is intentionally unmanaged, add its name to `KNOWN_UNDECLARED_FUNCTIONS` / `KNOWN_UNDECLARED_TRIGGERS` in `shared/db-object-audit.ts` (mirrors `KNOWN_UNDECLARED_COLUMNS`).

**Allowlist scope is narrow — name-extras only.** `KNOWN_UNDECLARED_*` suppresses *out-of-band extras* (in DB, no backing migration). It must NOT suppress missing-from-DB, and must NOT suppress body/definition drift. The kb objects are listed in the allowlist as a parsing safety net *and* are migration-managed, so body drift on them must still fail. `diffObjectDefinitions` deliberately ignores the allowlist for exactly this reason — it only diffs the expected(migrations)∩actual(DB) intersection, and truly-unmanaged objects never land in `expected`.

**Body/definition drift is now checked, not just names.** A trigger/function silently `CREATE OR REPLACE`d out of band (same name, changed logic) is caught by comparing live `pg_proc.prosrc` (functions) and `pg_get_triggerdef` (triggers) against what the migrations would produce. Normalisation: functions = whitespace-collapse, case-preserved (prosrc stores the body verbatim, so a real migrate matches exactly; a keyword/literal change is real drift). Triggers = strip `"`/`;`/`public.`, fold `EXECUTE PROCEDURE`→`EXECUTE FUNCTION`, whitespace-collapse, uppercase (identifiers are lowercase snake_case so uppercasing both sides is safe and absorbs keyword-case diffs from pg_get_triggerdef). Mismatch ⇒ exit 1 with a `REDEFINED …` report.
