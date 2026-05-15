import { Pool } from "pg";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../shared/schema";

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
  await pool.end();

  const actual = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!actual.has(r.table_name)) actual.set(r.table_name, new Set());
    actual.get(r.table_name)!.add(r.column_name);
  }

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

  if (missingTables.length === 0 && missingCols.length === 0 && extraCols.length === 0) {
    console.log("OK: every column in shared/schema.ts exists in the DB and vice versa.");
    process.exit(0);
  }

  if (missingTables.length > 0) {
    console.log(`MISSING TABLES (${missingTables.length}):`);
    for (const t of missingTables) console.log(`  - ${t}`);
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

  process.exit(missingTables.length > 0 || missingCols.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
