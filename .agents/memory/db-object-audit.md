---
name: DB trigger/function drift audit
description: Where out-of-band Postgres triggers/functions get caught and how to satisfy the gate.
---
The column audit (`script/audit-columns.ts`, run as `db:check:columns` in prebuild) also audits Postgres triggers and functions.

**The rule:** every user-defined trigger/function in the DB must be created by a committed `migrations/*.sql` file. Any object in the DB with no backing migration (or a migration object missing from the DB) fails the build (exit 1).

**Why:** drizzle's `shared/schema.ts` does not model triggers/functions, so they live only in raw-SQL migrations. The kb_articles search_vector trigger once lived fully out of band → a fresh migrate had the trigger but no column → every kb save threw Postgres 42703. Name-level drift detection catches the next such object before deploy.

**How to apply:** when adding a trigger/function, put idempotent DDL in a migration (model it on `migrations/0026_kb_search_vector.sql`). If an object is intentionally unmanaged, add its name to `KNOWN_UNDECLARED_FUNCTIONS` / `KNOWN_UNDECLARED_TRIGGERS` in `shared/db-object-audit.ts` (mirrors `KNOWN_UNDECLARED_COLUMNS`). The allowlist only suppresses extra-in-DB findings, never missing-from-DB. Audit is name-only — it does not compare bodies/signatures.
