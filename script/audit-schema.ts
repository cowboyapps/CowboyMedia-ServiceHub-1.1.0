import { readFileSync } from "fs";
import { join } from "path";
import { Pool } from "pg";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required. Run: source /opt/servicehub/.env");
    process.exit(1);
  }

  const schemaText = readFileSync(join(process.cwd(), "shared", "schema.ts"), "utf-8");
  const expected = new Set<string>();
  for (const m of schemaText.matchAll(/pgTable\(\s*"([a-zA-Z0-9_]+)"/g)) {
    expected.add(m[1]);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const { rows } = await pool.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  await pool.end();
  const actual = new Set(rows.map((r) => r.table_name));

  const missing = [...expected].filter((t) => !actual.has(t)).sort();
  const KNOWN_UNMANAGED = new Set(["__drizzle_migrations", "session"]);
  const extra = [...actual].filter((t) => !expected.has(t) && !KNOWN_UNMANAGED.has(t)).sort();

  console.log(`Schema audit: ${expected.size} tables in shared/schema.ts, ${actual.size} tables in DB.`);
  console.log("");

  if (missing.length === 0 && extra.length === 0) {
    console.log("OK: every table in shared/schema.ts exists in the DB and vice versa.");
    process.exit(0);
  }

  if (missing.length > 0) {
    console.log(`MISSING from DB (${missing.length}): defined in schema.ts but not in DB.`);
    console.log(`  These are tables drizzle expects to find. Likely caused by a schema.ts edit that never had db:generate run, or a migration that did not apply on this environment.`);
    for (const t of missing) console.log(`  - ${t}`);
    console.log("");
  }

  if (extra.length > 0) {
    console.log(`EXTRA in DB (${extra.length}): present in DB but not declared in schema.ts.`);
    console.log(`  Usually orphan tables from removed features. Safe unless application code still queries them.`);
    for (const t of extra) console.log(`  - ${t}`);
    console.log("");
  }

  process.exit(missing.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("audit failed:", e);
  process.exit(1);
});
