import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";
import {
  KNOWN_UNDECLARED_COLUMNS,
  KNOWN_UNDECLARED_CONSTRAINTS,
  KNOWN_UNDECLARED_FUNCTIONS,
  KNOWN_UNDECLARED_INDEXES,
  KNOWN_UNDECLARED_TRIGGERS,
  KNOWN_UNMANAGED_TABLES,
  diffDbObjects,
  diffObjectDefinitions,
  normalizeConstraintDef,
  normalizeFunctionBody,
  normalizeIndexDef,
  normalizeTriggerDef,
  parseMigrationConstraintDefs,
  parseMigrationDbObjects,
  parseMigrationFunctionBodies,
  parseMigrationIndexDefs,
  parseMigrationTriggerDefs,
} from "../shared/db-object-audit";

// Keeps mismatch output readable when a normalised body/definition is long.
function truncate(s: string, max = 160): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. Run: source /opt/servicehub/.env");
    process.exit(1);
  }

  const expected = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const cfg = getTableConfig(value as PgTable);
    expected.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const { rows } = await pool.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, ordinal_position`,
  );

  // User-defined (non-internal) triggers in the public schema, with their
  // canonical definition (pg_get_triggerdef) so we can detect a trigger that
  // was silently redefined out of band with the same name but a different
  // table / timing / event / function.
  const { rows: triggerRows } = await pool.query<{
    trigger_name: string;
    trigger_def: string;
  }>(
    `SELECT t.tgname AS trigger_name,
            pg_get_triggerdef(t.oid) AS trigger_def
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
       ORDER BY t.tgname`,
  );

  // User-defined (non-aggregate, non-window, non-extension) functions in the
  // public schema, with their body (pg_proc.prosrc) so we can detect a function
  // that was silently redefined out of band with the same name but changed
  // logic. Extension-owned functions are excluded via pg_depend so a future
  // `CREATE EXTENSION` does not trip the audit.
  const { rows: functionRows } = await pool.query<{
    function_name: string;
    function_body: string;
  }>(
    `SELECT p.proname AS function_name,
            p.prosrc AS function_body
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prokind = 'f'
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
         )
       ORDER BY p.proname`,
  );

  // User-defined indexes in the public schema, with their canonical definition
  // (pg_get_indexdef) so we can detect a raw-SQL index that a migration creates
  // but that is missing here, or one redefined out of band with different
  // columns / opclass / predicate. PRIMARY KEY and UNIQUE/EXCLUSION constraint
  // indexes are excluded: they are created from constraints declared in
  // shared/schema.ts (CREATE TABLE / ALTER TABLE), NOT via CREATE INDEX in a
  // migration, and are already covered by the column audit. What remains is the
  // set of indexes migrations create with explicit CREATE [UNIQUE] INDEX.
  const { rows: indexRows } = await pool.query<{
    index_name: string;
    index_def: string;
  }>(
    `SELECT c.relname AS index_name,
            pg_get_indexdef(i.indexrelid) AS index_def
       FROM pg_index i
       JOIN pg_class c ON c.oid = i.indexrelid
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'
         AND NOT i.indisprimary
         AND NOT EXISTS (
           SELECT 1 FROM pg_constraint con WHERE con.conindid = i.indexrelid
         )
       ORDER BY c.relname`,
  );

  // User-defined CHECK / FOREIGN KEY / UNIQUE constraints on tables in the
  // public schema, with their canonical definition (pg_get_constraintdef) so we
  // can detect a constraint a migration creates but that is missing here, or one
  // redefined out of band (e.g. an FK with a different ON DELETE rule, or a
  // relaxed CHECK). PRIMARY KEY (contype 'p') is excluded — it's declared in
  // shared/schema.ts and already covered by the column audit. Extension-owned
  // constraints are excluded via pg_depend so a future `CREATE EXTENSION` does
  // not trip the audit. conrelid <> 0 restricts to table constraints (skips any
  // domain CHECKs).
  const { rows: constraintRows } = await pool.query<{
    constraint_name: string;
    constraint_def: string;
  }>(
    `SELECT con.conname AS constraint_name,
            pg_get_constraintdef(con.oid) AS constraint_def
       FROM pg_constraint con
       JOIN pg_namespace n ON n.oid = con.connamespace
       WHERE n.nspname = 'public'
         AND con.contype IN ('c', 'f', 'u')
         AND con.conrelid <> 0
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d WHERE d.objid = con.oid AND d.deptype = 'e'
         )
       ORDER BY con.conname`,
  );
  await pool.end();

  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

  // Stray tables: present in the DB but not declared in shared/schema.ts and
  // not allowlisted as intentionally unmanaged infra (drizzle's journal, the
  // session store). These are orphans left behind by removed features or
  // out-of-band CREATE TABLEs; treated as a build failure just like out-of-band
  // triggers/functions, so they can't drift into a deploy unnoticed.
  const tableDiff = diffDbObjects(
    new Set(expected.keys()),
    new Set(actual.keys()),
    KNOWN_UNMANAGED_TABLES,
  );
  const extraTables = tableDiff.extra;

  const missingTables: string[] = [];
  const missingCols: Array<{ table: string; columns: string[] }> = [];
  const extraCols: Array<{ table: string; columns: string[] }> = [];

  for (const [table, expectedCols] of expected) {
    const actualCols = actual.get(table);
    if (!actualCols) {
      missingTables.push(table);
      continue;
    }
    const missing = [...expectedCols].filter((c) => !actualCols.has(c)).sort();
    if (missing.length > 0) missingCols.push({ table, columns: missing });
    const allowed = KNOWN_UNDECLARED_COLUMNS[table] ?? new Set<string>();
    const extra = [...actualCols].filter((c) => !expectedCols.has(c) && !allowed.has(c)).sort();
    if (extra.length > 0) extraCols.push({ table, columns: extra });
  }

  console.log(
    `Column audit: ${expected.size} tables in shared/schema.ts, ${actual.size} tables in DB.`,
  );
  console.log("");

  const columnsOk =
    missingTables.length === 0 &&
    missingCols.length === 0 &&
    extraCols.length === 0 &&
    extraTables.length === 0;
  if (columnsOk) {
    console.log("OK: every column in shared/schema.ts exists in the DB and vice versa.");
  }

  if (missingTables.length > 0) {
    console.log(`MISSING TABLES (${missingTables.length}):`);
    for (const t of missingTables) console.log(`  - ${t}`);
    console.log("");
  }

  if (extraTables.length > 0) {
    console.log(`STRAY TABLES (${extraTables.length}): present in the DB but not declared in shared/schema.ts.`);
    console.log(`  Orphans from a removed feature or an out-of-band CREATE TABLE. Either add a`);
    console.log(`  pgTable for them in shared/schema.ts (+ a migration), drop them with a`);
    console.log(`  migration, or allowlist them in KNOWN_UNMANAGED_TABLES in shared/db-object-audit.ts`);
    console.log(`  if they are intentionally unmanaged infrastructure.`);
    for (const t of extraTables) console.log(`  - ${t}`);
    console.log("");
  }

  if (missingCols.length > 0) {
    console.log(`MISSING COLUMNS (in DB but expected by schema.ts):`);
    for (const { table, columns } of missingCols) {
      console.log(`  ${table}:`);
      for (const c of columns) console.log(`    - ${c}`);
    }
    console.log("");
  }

  if (extraCols.length > 0) {
    console.log(`EXTRA COLUMNS (in DB but not declared in schema.ts; usually safe orphans):`);
    for (const { table, columns } of extraCols) {
      console.log(`  ${table}:`);
      for (const c of columns) console.log(`    - ${c}`);
    }
    console.log("");
  }

  // ---- Trigger / function drift -------------------------------------------
  // The committed migrations are the source of truth (drizzle's schema.ts does
  // not model triggers or functions). Parse what they create, diff against the
  // live DB, and fail closed on anything out of band — the exact class of drift
  // that broke every kb_articles save when the search_vector trigger lived
  // outside migrations.
  const migrationsDir = join(process.cwd(), "migrations");
  const migrationSql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf-8"));
  const expectedObjects = parseMigrationDbObjects(migrationSql);

  const actualFunctions = new Set(functionRows.map((r) => r.function_name));
  const actualTriggers = new Set(triggerRows.map((r) => r.trigger_name));

  const functionDiff = diffDbObjects(
    expectedObjects.functions,
    actualFunctions,
    KNOWN_UNDECLARED_FUNCTIONS,
  );
  const triggerDiff = diffDbObjects(
    expectedObjects.triggers,
    actualTriggers,
    KNOWN_UNDECLARED_TRIGGERS,
  );

  console.log(
    `Object audit: ${expectedObjects.functions.size} functions / ${expectedObjects.triggers.size} triggers in migrations, ${actualFunctions.size} functions / ${actualTriggers.size} triggers in DB.`,
  );
  console.log("");

  const objectsOk =
    functionDiff.missing.length === 0 &&
    functionDiff.extra.length === 0 &&
    triggerDiff.missing.length === 0 &&
    triggerDiff.extra.length === 0;
  if (objectsOk) {
    console.log(
      "OK: every trigger/function in migrations exists in the DB and vice versa.",
    );
  }

  if (functionDiff.missing.length > 0) {
    console.log(`MISSING FUNCTIONS (defined in a migration but not in the DB):`);
    console.log(
      `  A migration that creates these never applied here. KB search and any other`,
    );
    console.log(`  trigger-backed feature will break. Run db:migrate.`);
    for (const f of functionDiff.missing) console.log(`    - ${f}`);
    console.log("");
  }

  if (triggerDiff.missing.length > 0) {
    console.log(`MISSING TRIGGERS (defined in a migration but not in the DB):`);
    for (const t of triggerDiff.missing) console.log(`    - ${t}`);
    console.log("");
  }

  if (functionDiff.extra.length > 0) {
    console.log(`OUT-OF-BAND FUNCTIONS (in DB but created by no committed migration):`);
    console.log(
      `  Move the DDL into a migration (idempotent, like 0026_kb_search_vector.sql)`,
    );
    console.log(
      `  or allowlist it in shared/db-object-audit.ts if it is intentionally unmanaged.`,
    );
    for (const f of functionDiff.extra) console.log(`    - ${f}`);
    console.log("");
  }

  if (triggerDiff.extra.length > 0) {
    console.log(`OUT-OF-BAND TRIGGERS (in DB but created by no committed migration):`);
    console.log(
      `  Move the DDL into a migration (idempotent, like 0026_kb_search_vector.sql)`,
    );
    console.log(
      `  or allowlist it in shared/db-object-audit.ts if it is intentionally unmanaged.`,
    );
    for (const t of triggerDiff.extra) console.log(`    - ${t}`);
    console.log("");
  }

  // ---- Index drift --------------------------------------------------------
  // Raw-SQL indexes created in migrations (CREATE [UNIQUE] INDEX) aren't modelled
  // by drizzle's column audit. Diff their names and normalised definitions
  // against the live DB so a missing index (migration never applied here →
  // silent performance regression) or one redefined out of band (different
  // columns/opclass/predicate) fails the gate the same way triggers/functions do.
  const expectedIndexDefs = parseMigrationIndexDefs(migrationSql);
  const actualIndexDefs = new Map(
    indexRows.map((r) => [r.index_name, normalizeIndexDef(r.index_def ?? "")]),
  );

  const indexDiff = diffDbObjects(
    new Set(expectedIndexDefs.keys()),
    new Set(actualIndexDefs.keys()),
    KNOWN_UNDECLARED_INDEXES,
  );
  const indexDefMismatches = diffObjectDefinitions(
    expectedIndexDefs,
    actualIndexDefs,
  );

  console.log(
    `Index audit: ${expectedIndexDefs.size} indexes in migrations, ${actualIndexDefs.size} non-constraint indexes in DB.`,
  );
  console.log("");

  const indexesOk =
    indexDiff.missing.length === 0 &&
    indexDiff.extra.length === 0 &&
    indexDefMismatches.length === 0;
  if (indexesOk) {
    console.log("OK: every index in migrations exists in the DB and matches.");
  }

  if (indexDiff.missing.length > 0) {
    console.log(`MISSING INDEXES (defined in a migration but not in the DB):`);
    console.log(
      `  A migration that creates these never applied here. Queries that rely on`,
    );
    console.log(`  them silently fall back to sequential scans. Run db:migrate.`);
    for (const i of indexDiff.missing) console.log(`    - ${i}`);
    console.log("");
  }

  if (indexDiff.extra.length > 0) {
    console.log(`OUT-OF-BAND INDEXES (in DB but created by no committed migration):`);
    console.log(
      `  Move the DDL into a migration, or allowlist it in KNOWN_UNDECLARED_INDEXES`,
    );
    console.log(`  in shared/db-object-audit.ts if it is intentionally unmanaged.`);
    for (const i of indexDiff.extra) console.log(`    - ${i}`);
    console.log("");
  }

  if (indexDefMismatches.length > 0) {
    console.log(`REDEFINED INDEXES (definition in DB differs from its migration):`);
    console.log(
      `  These were changed out of band (different columns/opclass/predicate). A`,
    );
    console.log(`  fresh db:migrate would build a different index. Reconcile via a migration.`);
    for (const m of indexDefMismatches) {
      console.log(`    - ${m.name}`);
      console.log(`        migration: ${truncate(m.expected)}`);
      console.log(`        live DB:   ${truncate(m.actual)}`);
    }
    console.log("");
  }

  // ---- Body / definition drift --------------------------------------------
  // Name matches above only prove an object EXISTS. Here we compare the live
  // body/definition against what the committed migrations would produce, so a
  // function or trigger that was silently REDEFINED out of band (same name,
  // changed logic) is caught — the same "works in dev, breaks on a fresh
  // migrate" failure mode, one level deeper.
  const expectedFunctionBodies = parseMigrationFunctionBodies(migrationSql);
  const expectedTriggerDefs = parseMigrationTriggerDefs(migrationSql);

  const actualFunctionBodies = new Map(
    functionRows.map((r) => [
      r.function_name,
      normalizeFunctionBody(r.function_body ?? ""),
    ]),
  );
  const actualTriggerDefs = new Map(
    triggerRows.map((r) => [
      r.trigger_name,
      normalizeTriggerDef(r.trigger_def ?? ""),
    ]),
  );

  const functionBodyMismatches = diffObjectDefinitions(
    expectedFunctionBodies,
    actualFunctionBodies,
  );
  const triggerDefMismatches = diffObjectDefinitions(
    expectedTriggerDefs,
    actualTriggerDefs,
  );

  const definitionsOk =
    functionBodyMismatches.length === 0 && triggerDefMismatches.length === 0;
  if (objectsOk && definitionsOk) {
    console.log(
      "OK: every shared trigger/function body matches its committed migration.",
    );
  }

  if (functionBodyMismatches.length > 0) {
    console.log(`REDEFINED FUNCTIONS (body in DB differs from its migration):`);
    console.log(
      `  These were changed out of band. A fresh db:migrate would produce different`,
    );
    console.log(
      `  logic. Reconcile by moving the change into a new migration (CREATE OR REPLACE).`,
    );
    for (const m of functionBodyMismatches) {
      console.log(`    - ${m.name}`);
      console.log(`        migration: ${truncate(m.expected)}`);
      console.log(`        live DB:   ${truncate(m.actual)}`);
    }
    console.log("");
  }

  if (triggerDefMismatches.length > 0) {
    console.log(`REDEFINED TRIGGERS (definition in DB differs from its migration):`);
    console.log(
      `  These were changed out of band. A fresh db:migrate would produce a different`,
    );
    console.log(`  trigger. Reconcile by moving the change into a new migration.`);
    for (const m of triggerDefMismatches) {
      console.log(`    - ${m.name}`);
      console.log(`        migration: ${truncate(m.expected)}`);
      console.log(`        live DB:   ${truncate(m.actual)}`);
    }
    console.log("");
  }

  // ---- Constraint drift ---------------------------------------------------
  // CHECK / FOREIGN KEY / UNIQUE constraints declared in shared/schema.ts are
  // emitted into the migrations but not modelled by drizzle's column audit.
  // Diff their names and normalised definitions against the live DB so a missing
  // constraint (migration never applied here → data-integrity guarantee gone) or
  // one redefined out of band (e.g. a relaxed ON DELETE rule or CHECK) fails the
  // gate the same way triggers/functions/indexes do.
  const expectedConstraintDefs = parseMigrationConstraintDefs(migrationSql);
  const actualConstraintDefs = new Map(
    constraintRows.map((r) => [
      r.constraint_name,
      normalizeConstraintDef(r.constraint_def ?? ""),
    ]),
  );

  const constraintDiff = diffDbObjects(
    new Set(expectedConstraintDefs.keys()),
    new Set(actualConstraintDefs.keys()),
    KNOWN_UNDECLARED_CONSTRAINTS,
  );
  const constraintDefMismatches = diffObjectDefinitions(
    expectedConstraintDefs,
    actualConstraintDefs,
  );

  console.log(
    `Constraint audit: ${expectedConstraintDefs.size} CHECK/FK/UNIQUE constraints in migrations, ${actualConstraintDefs.size} in DB.`,
  );
  console.log("");

  const constraintsOk =
    constraintDiff.missing.length === 0 &&
    constraintDiff.extra.length === 0 &&
    constraintDefMismatches.length === 0;
  if (constraintsOk) {
    console.log(
      "OK: every CHECK/FK/UNIQUE constraint in migrations exists in the DB and matches.",
    );
  }

  if (constraintDiff.missing.length > 0) {
    console.log(`MISSING CONSTRAINTS (defined in a migration but not in the DB):`);
    console.log(
      `  A migration that creates these never applied here. The data-integrity`,
    );
    console.log(
      `  guarantee they enforce (uniqueness, referential integrity, a CHECK) is`,
    );
    console.log(`  gone. Run db:migrate.`);
    for (const c of constraintDiff.missing) console.log(`    - ${c}`);
    console.log("");
  }

  if (constraintDiff.extra.length > 0) {
    console.log(`OUT-OF-BAND CONSTRAINTS (in DB but created by no committed migration):`);
    console.log(
      `  Move the DDL into a migration, or allowlist it in KNOWN_UNDECLARED_CONSTRAINTS`,
    );
    console.log(`  in shared/db-object-audit.ts if it is intentionally unmanaged.`);
    for (const c of constraintDiff.extra) console.log(`    - ${c}`);
    console.log("");
  }

  if (constraintDefMismatches.length > 0) {
    console.log(`REDEFINED CONSTRAINTS (definition in DB differs from its migration):`);
    console.log(
      `  These were changed out of band (e.g. a different ON DELETE rule, changed`,
    );
    console.log(
      `  columns, or a loosened CHECK). A fresh db:migrate would build a different`,
    );
    console.log(`  constraint. Reconcile via a migration.`);
    for (const m of constraintDefMismatches) {
      console.log(`    - ${m.name}`);
      console.log(`        migration: ${truncate(m.expected)}`);
      console.log(`        live DB:   ${truncate(m.actual)}`);
    }
    console.log("");
  }

  const hasColumnFailure =
    missingTables.length > 0 || missingCols.length > 0 || extraTables.length > 0;
  process.exit(
    hasColumnFailure ||
      !objectsOk ||
      !definitionsOk ||
      !indexesOk ||
      !constraintsOk
      ? 1
      : 0,
  );
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
