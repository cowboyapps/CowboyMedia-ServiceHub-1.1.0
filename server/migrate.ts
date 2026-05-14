import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";
import { db } from "./db";

// Resolve the migrations folder. In dev we run from repo root; in prod the
// pm2 process is started with cwd=/opt/servicehub which also contains the
// migrations/ directory checked into git. Both paths land on the same place.
function migrationsFolder(): string {
  return join(process.cwd(), "migrations");
}

// Parse every `CREATE TABLE "<name>"` statement out of a baseline SQL file.
// This is the authoritative set of tables the baseline expects to create —
// we use it as a fingerprint for "is this DB already at baseline?".
function extractBaselineTables(baselineSqlText: string): string[] {
  const re = /CREATE TABLE "([a-zA-Z0-9_]+)"/g;
  const out = new Set<string>();
  for (const m of baselineSqlText.matchAll(re)) out.add(m[1]);
  return [...out].sort();
}

// Bootstrap path: when this code first lands on a long-running prod database
// that already has every table defined in shared/schema.ts (because the old
// db:push + self-heal block created them ages ago), the drizzle migrator
// would try to re-apply 0000_baseline.sql and fail with "relation already
// exists". To avoid that, we detect the situation and pre-insert the baseline
// hash into drizzle.__drizzle_migrations so the migrator skips it.
//
// Detection rule (tri-state, fail-closed):
//   - __drizzle_migrations is non-empty → already tracked, return.
//   - Of the N tables the baseline would create, count how many already
//     exist in `public`:
//       * 0          → virgin DB. Return without bootstrapping; let the
//                      migrator create everything from scratch.
//       * N (all)    → existing prod DB that legacy db:push fully populated.
//                      Pre-mark baseline as applied.
//       * 0 < k < N  → AMBIGUOUS / PARTIAL. We refuse to silently accept
//                      this state — pre-marking would lock in missing
//                      tables forever with no hard failure. Abort startup
//                      with an explicit list of the missing tables so an
//                      operator can investigate.
//
// Only the baseline (idx 0) is ever pre-marked. Any genuine new migrations
// the journal grows over time apply normally on top.
async function bootstrapBaselineIfNeeded(folder: string): Promise<void> {
  const journalPath = join(folder, "meta", "_journal.json");
  if (!existsSync(journalPath)) return;
  const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
    entries: Array<{ idx: number; tag: string; when: number }>;
  };
  const baseline = journal.entries.find((e) => e.idx === 0);
  if (!baseline) return;
  const baselinePath = join(folder, `${baseline.tag}.sql`);
  if (!existsSync(baselinePath)) return;

  // Ensure the migrations metadata schema/table exist before we touch them.
  // The migrator does this too, but we need them in place to read/write
  // BEFORE migrate() runs.
  await db.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  const countResult = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM "drizzle"."__drizzle_migrations"`,
  );
  const countRows = Array.isArray(countResult) ? countResult : countResult.rows;
  const existingCount = Number(countRows?.[0]?.c ?? 0);
  if (existingCount > 0) return; // already tracked — nothing to bootstrap

  const baselineSql = readFileSync(baselinePath, "utf-8");
  const expectedTables = extractBaselineTables(baselineSql);
  if (expectedTables.length === 0) return; // pathological baseline; let migrator handle

  // Count how many baseline tables actually exist in `public`. We expand the
  // expected list into individual parameters via sql.join so each name is its
  // own bind value (avoids drizzle's sql-template array-inlining behavior,
  // which would emit ANY('a', 'b', ...) and trip Postgres error 42809
  // "op ANY/ALL (array) requires array on right side").
  const presentResult = await db.execute<{ name: string }>(sql`
    SELECT table_name AS name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name IN (${sql.join(expectedTables.map((t) => sql`${t}`), sql`, `)})
  `);
  const presentRows = Array.isArray(presentResult) ? presentResult : presentResult.rows;
  const presentSet = new Set((presentRows ?? []).map((r) => r.name));
  const presentCount = presentSet.size;

  if (presentCount === 0) {
    // Virgin DB. Let migrate() create everything. Do NOT pre-mark.
    return;
  }

  if (presentCount < expectedTables.length) {
    // Partial / drifted state. Refuse to silently accept it — pre-marking
    // would tell drizzle the baseline already ran and the missing tables
    // would never get created. Fail closed with a precise error so an
    // operator can decide whether to (a) restore from a clean dump,
    // (b) hand-create the missing tables, or (c) wipe + let the migrator
    // do it on a virgin schema.
    const missing = expectedTables.filter((t) => !presentSet.has(t));
    throw new Error(
      `[migrate] bootstrap aborted: __drizzle_migrations is empty AND the public schema is in a partial/ambiguous state. ` +
        `${presentCount}/${expectedTables.length} baseline tables present; missing ${missing.length}: ` +
        `${missing.slice(0, 10).join(", ")}${missing.length > 10 ? `, … (+${missing.length - 10} more)` : ""}. ` +
        `Refusing to pre-mark baseline as applied because doing so would lock in the missing tables. ` +
        `Operator action: either restore a clean dump, manually create the missing tables, or drop the partial schema to let the migrator rebuild from scratch.`,
    );
  }

  // All expected baseline tables present → existing prod DB. Safe to skip.
  const baselineHash = crypto.createHash("sha256").update(baselineSql).digest("hex");
  await db.execute(sql`
    INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
    VALUES (${baselineHash}, ${baseline.when})
  `);
  console.log(
    `[migrate] bootstrap: verified all ${expectedTables.length} baseline tables present; ` +
      `marked baseline (${baseline.tag}) as already-applied on existing DB`,
  );
}

// Run before registerRoutes(). Aborts the process on failure so pm2 won't
// flip to a build whose schema migrations did not apply cleanly.
export async function runMigrations(): Promise<void> {
  const folder = migrationsFolder();
  if (!existsSync(folder)) {
    // Fail closed: a missing migrations/ folder means the build is broken
    // (the directory is committed to git). Returning here would let the
    // server boot with whatever schema happens to be on disk — exactly the
    // silent-skip failure mode we just removed db:push to avoid.
    throw new Error(
      `[migrate] migrations folder not found at ${folder}. Refusing to start. ` +
        `This usually means the build is missing committed files; do not bypass.`,
    );
  }
  await bootstrapBaselineIfNeeded(folder);
  await migrate(db, { migrationsFolder: folder });
  console.log("[migrate] migrations up to date");
}
