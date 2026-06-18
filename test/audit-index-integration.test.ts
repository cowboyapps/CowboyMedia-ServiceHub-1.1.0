import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";

// End-to-end coverage for the index-drift half of script/audit-columns.ts.
//
// The pure normalisation/parsing helpers in shared/db-object-audit.ts are
// exhaustively unit-tested in test/db-object-audit.test.ts. What was previously
// only manually verified is the live wiring: the pg_index SQL query that filters
// out PRIMARY KEY / constraint-backed indexes, mapping its rows into the diff,
// and the process exit code. This test spins the real audit up against a freshly
// migrated throwaway database and asserts:
//   1. a clean migrated DB → exit 0 with no index findings
//   2. a dropped index      → MISSING INDEXES section + exit 1
//   3. a redefined index    → REDEFINED INDEXES section + exit 1
//   4. an out-of-band index → OUT-OF-BAND INDEXES section + exit 1
//   5. a constraint-backed index is NEVER flagged out-of-band (the pg_constraint
//      exclusion in the SQL query)
//
// It creates its own database (CREATE DATABASE <unique>), applies every committed
// migration via script/migrate.ts, mutates indexes between assertions, and drops
// the database at the end — the dev/CI database is never touched. Skips cleanly
// when DATABASE_URL is unset or the role lacks CREATEDB privilege (e.g. a locked
// down deploy-gate role), so it never breaks the prebuild gate where it can't run.

const BASE_URL = process.env.DATABASE_URL;

interface AuditResult {
  status: number;
  output: string;
}

// Runs the real audit against `databaseUrl` and captures its exit code + output.
// execFileSync throws on a non-zero exit; the thrown error carries .status and
// the captured stdout/stderr (strings, because encoding is set).
function runAudit(databaseUrl: string): AuditResult {
  try {
    const stdout = execFileSync("tsx", ["script/audit-columns.ts"], {
      env: { ...process.env, DATABASE_URL: databaseUrl, NODE_ENV: "test" },
      encoding: "utf-8",
    });
    return { status: 0, output: stdout };
  } catch (e: any) {
    return {
      status: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

test("index audit end-to-end against a migrated database", async (t) => {
  if (!BASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const tempName = `sh_idx_audit_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: BASE_URL });

  // CREATE DATABASE first; bail out cleanly if the role can't (so the prebuild
  // gate on a restricted role skips rather than fails).
  try {
    await admin.query(`CREATE DATABASE "${tempName}"`);
  } catch (e: any) {
    await admin.end();
    t.skip(`cannot CREATE DATABASE (insufficient privilege?): ${e?.message ?? e}`);
    return;
  }

  const tempUrl = new URL(BASE_URL);
  tempUrl.pathname = `/${tempName}`;
  const tempUrlStr = tempUrl.toString();
  const pool = new Pool({ connectionString: tempUrlStr });

  try {
    // Apply every committed migration to the throwaway DB — the same entry point
    // (script/migrate.ts → runMigrations) the deploy gate and app boot use.
    execFileSync("tsx", ["script/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: tempUrlStr, NODE_ENV: "test" },
      encoding: "utf-8",
    });

    await t.test("clean migrated DB → exit 0 with no index findings", () => {
      const r = runAudit(tempUrlStr);
      assert.equal(r.status, 0, r.output);
      assert.match(
        r.output,
        /OK: every index in migrations exists in the DB and matches\./,
      );
      assert.doesNotMatch(r.output, /MISSING INDEXES/);
      assert.doesNotMatch(r.output, /OUT-OF-BAND INDEXES/);
      assert.doesNotMatch(r.output, /REDEFINED INDEXES/);
    });

    await t.test("dropped index → MISSING INDEXES section + exit 1", async () => {
      await pool.query(`DROP INDEX "users_role_idx"`);
      try {
        const r = runAudit(tempUrlStr);
        assert.equal(r.status, 1);
        assert.match(r.output, /MISSING INDEXES/);
        assert.match(r.output, /users_role_idx/);
      } finally {
        await pool.query(
          `CREATE INDEX "users_role_idx" ON "users" USING btree ("role")`,
        );
      }
    });

    await t.test("redefined index → REDEFINED INDEXES section + exit 1", async () => {
      // Same NAME as a migration index, but a different column → definition drift.
      await pool.query(`DROP INDEX "users_role_idx"`);
      await pool.query(
        `CREATE INDEX "users_role_idx" ON "users" USING btree ("id")`,
      );
      try {
        const r = runAudit(tempUrlStr);
        assert.equal(r.status, 1);
        assert.match(r.output, /REDEFINED INDEXES/);
        assert.match(r.output, /users_role_idx/);
        // Not a missing/extra finding — the name still matches a migration.
        assert.doesNotMatch(r.output, /MISSING INDEXES/);
      } finally {
        await pool.query(`DROP INDEX "users_role_idx"`);
        await pool.query(
          `CREATE INDEX "users_role_idx" ON "users" USING btree ("role")`,
        );
      }
    });

    await t.test("out-of-band index → OUT-OF-BAND INDEXES section + exit 1", async () => {
      await pool.query(
        `CREATE INDEX "audit_test_oob_idx" ON "users" USING btree ("email")`,
      );
      try {
        const r = runAudit(tempUrlStr);
        assert.equal(r.status, 1);
        assert.match(r.output, /OUT-OF-BAND INDEXES/);
        assert.match(r.output, /audit_test_oob_idx/);
      } finally {
        await pool.query(`DROP INDEX "audit_test_oob_idx"`);
      }
    });

    await t.test(
      "constraint-backed index is never flagged out-of-band (pg_constraint exclusion)",
      async () => {
        // A UNIQUE constraint adds an index to pg_class, but it is created from a
        // constraint (not CREATE INDEX in a migration) so the INDEX audit's
        // pg_index query must filter it out — otherwise it would look like an
        // out-of-band extra index. id is the PK so its values are already unique
        // (table is empty anyway), making the constraint valid.
        //
        // The constraint itself IS out-of-band, so the separate CONSTRAINT audit
        // legitimately flags it (overall exit 1). This test therefore asserts on
        // the INDEX audit specifically — it must stay silent — and confirms the
        // CONSTRAINT audit is what surfaces the out-of-band object, rather than
        // asserting a global exit 0 (which the constraint audit correctly breaks).
        await pool.query(
          `ALTER TABLE "users" ADD CONSTRAINT "audit_test_uq" UNIQUE ("id")`,
        );
        try {
          const r = runAudit(tempUrlStr);
          // Index audit stays clean: the constraint-backed index is excluded.
          assert.doesNotMatch(r.output, /OUT-OF-BAND INDEXES/);
          assert.match(
            r.output,
            /every index in migrations exists in the DB and matches/,
          );
          // Sanity: the constraint audit (not a silent miss) is what flags it.
          assert.match(r.output, /OUT-OF-BAND CONSTRAINTS/);
          assert.match(r.output, /audit_test_uq/);
        } finally {
          await pool.query(`ALTER TABLE "users" DROP CONSTRAINT "audit_test_uq"`);
        }
      },
    );
  } finally {
    await pool.end();
    // Drop connections that might linger, then drop the throwaway DB.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [tempName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${tempName}"`);
    await admin.end();
  }
});
