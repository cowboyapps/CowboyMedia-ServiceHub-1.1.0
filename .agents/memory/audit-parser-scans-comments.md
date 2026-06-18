---
name: Schema-audit migration parser scans raw SQL (comments included)
description: Why DDL-looking token sequences in migration comments break the index/constraint/object drift audit
---

The schema-drift audit (`script/audit-columns.ts` via `shared/db-object-audit.ts`:
`parseMigrationIndexDefs`, `parseMigrationConstraintDefs`, `parseMigrationDbObjects`)
regex-scans the **raw text** of every `migrations/*.sql` file. It does NOT strip
SQL comments first.

**Rule:** never write a DDL token sequence the parsers match inside a migration
comment — e.g. `CREATE INDEX`, `CREATE INDEX CONCURRENTLY`, `CREATE [UNIQUE] INDEX`,
`CREATE/DROP FUNCTION|TRIGGER`, `ALTER TABLE ... ADD CONSTRAINT`. Reword (e.g.
"concurrent index build", "index statements") so the literal sequence never appears.

**Why:** a comment line like `... via CREATE INDEX CONCURRENTLY).` makes
`parseMigrationIndexDefs` capture `CONCURRENTLY` as a phantom index name (the
optional `CONCURRENTLY\s+` group fails because `)` follows it), and its greedy
`[\s\S]*?;` then swallows the next real `CREATE INDEX` statement up to the first
semicolon — so a real index silently disappears from the expected set and shows as
MISSING while the phantom shows as another MISSING. Both fail the deploy gate.

**How to apply:** when authoring any custom/repair migration, keep prose comments
free of these literal DDL keyword sequences; after writing, sanity-check with
`parseMigrationIndexDefs([fileText]).keys()` and confirm the key count/names match
the actual statements (no phantom names, none missing).
