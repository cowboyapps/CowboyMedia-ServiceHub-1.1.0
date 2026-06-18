import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";
import {
  KNOWN_UNDECLARED_FUNCTIONS,
  KNOWN_UNDECLARED_TRIGGERS,
  KNOWN_UNMANAGED_TABLES,
  diffDbObjects,
  parseMigrationDbObjects,
} from "../shared/db-object-audit";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. Run: source /opt/servicehub/.env");
    process.exit(1);
  }

  // Columns that intentionally exist in the DB without a corresponding
  // shared/schema.ts declaration. Drizzle's type system doesn't model these
  // well (e.g. Postgres tsvector for full-text search), so we manage them via
  // raw SQL in storage.ts and exclude them from the drift check.
  const KNOWN_UNDECLARED_COLUMNS: Record<string, Set<string>> = {
    kb_articles: new Set(["search_vector"]),
  };

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

  // User-defined (non-internal) triggers in the public schema.
  const { rows: triggerRows } = await pool.query<{ trigger_name: string }>(
    `SELECT t.tgname AS trigger_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid = t.tgrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND NOT t.tgisinternal
       ORDER BY t.tgname`,
  );

  // User-defined (non-aggregate, non-window, non-extension) functions in the
  // public schema. Extension-owned functions are excluded via pg_depend so a
  // future `CREATE EXTENSION` does not trip the audit.
  const { rows: functionRows } = await pool.query<{ function_name: string }>(
    `SELECT p.proname AS function_name
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prokind = 'f'
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
         )
       ORDER BY p.proname`,
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

  const hasColumnFailure =
    missingTables.length > 0 || missingCols.length > 0 || extraTables.length > 0;
  process.exit(hasColumnFailure || !objectsOk ? 1 : 0);
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
