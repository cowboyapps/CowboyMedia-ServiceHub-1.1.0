---
name: Prod-only pre-drizzle schema drift
description: Why the deploy-gate schema audits fail on prod but not dev, and how to fix each drift class (rename-migration vs allowlist).
---

# Prod-only pre-drizzle schema drift

Production was originally built with hand-written SQL (`migrations/legacy/`) and
`drizzle-kit push` BEFORE this project adopted versioned drizzle migrations. The
dev DB is rebuilt purely from `migrations/`, so prod carries legacy database
objects that dev never has. The deploy-gate schema audits (`db:check:columns` →
`script/audit-columns.ts` + `shared/db-object-audit.ts`) therefore fail
**prod-only**, and the failures CANNOT be reproduced locally.

**Why:** legacy objects use old names/extra definitions that no committed
migration creates. The audit diffs "objects declared in migrations" vs "objects
in the live DB" — so legacy objects show up as OUT-OF-BAND (and, when a migration
declares the same logical object under a *different* name, also as MISSING).

**How to apply — pick the fix by drift class:**
- **Name drift with a managed counterpart** (e.g. UNIQUE constraints named the
  Postgres-default `<table>_<col>_key` on prod while migrations declare
  `<table>_<col>_unique`): fires as BOTH missing + out-of-band. Allowlisting
  canNOT fix it (the allowlist only suppresses extras, never missing). Ship an
  **idempotent, catalog-driven rename migration** (`ALTER ... RENAME CONSTRAINT`,
  guarded by NOT EXISTS on the target + reading the table from `pg_constraint`)
  so it renames on prod and no-ops on dev/fresh.
- **Genuinely unmanaged extras** (prod-only objects with no committed-migration
  equivalent — e.g. a composite UNIQUE constraint added by hand, or legacy
  `idx_*`/`*_uq` indexes from the push era): **allowlist** them in the
  `KNOWN_UNDECLARED_{INDEXES,CONSTRAINTS,...}` sets. Non-destructive; mirrors the
  session-store index precedent. Some legacy indexes are redundant duplicates of
  a modern managed index; others (incl. UNIQUE indexes) enforce integrity on prod
  but are absent from dev/schema — allowlisting tolerates that divergence rather
  than dropping prod objects (destructive) or adopting them into schema.ts
  (larger change, risks dev divergence). Reconciling parity is follow-up work.

**Audit safety guarantees** (so allowlisting is safe): in `diffDbObjects`, the
allowlist filters only `extra`, never `missing`. Definition-drift / redefinition
checks (`diffObjectDefinitions`) do NOT consult the allowlist. So allowlisting an
out-of-band name can never create a false green by hiding a missing or redefined
managed object.

**Gotcha:** the deploy gate runs the FULL prebuild on the VPS (incl. `npm test`).
A failed deploy that dies early (e.g. at `db:check:columns`) can hide a LATER
gate step's failure (e.g. an integration test) until the earlier step is fixed —
expect to fix drift in waves across multiple deploys.
