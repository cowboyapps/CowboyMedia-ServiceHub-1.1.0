import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";

// Server-side proof that the bulk resolve / bulk delete storage methods backing
// the "Resolve all" and "Clear all" admin buttons ONLY touch the rows matching
// the admin's severity/source/resolved/search filters — never the whole table.
//
// Task #638 covered the *client* forwarding those filters into the request URL.
// This is the destructive other half: if resolveAllErrorLogs / deleteAllErrorLogs
// silently dropped a WHERE clause, an admin filtering to a handful of rows could
// wipe or acknowledge every row in the log. The in-memory mock in
// server/error-log-routes.test.ts reimplements the filter logic, so it can't
// catch a bug in the real Drizzle SQL. This test therefore runs the REAL
// DatabaseStorage against a freshly migrated throwaway Postgres.
//
// Mirrors test/audit-index-integration.test.ts: CREATE DATABASE a unique name,
// apply every committed migration via script/migrate.ts, point DATABASE_URL at
// it BEFORE importing server/storage (the pool binds the URL at import time),
// run the assertions, then drop the database. Skips cleanly when DATABASE_URL is
// unset or the role lacks CREATEDB privilege, so it never breaks the prebuild
// gate where it can't run.

const BASE_URL = process.env.DATABASE_URL;

test("bulk resolve/delete storage only touches the filtered rows", async (t) => {
  if (!BASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const tempName = `sh_bulk_filter_${process.pid}_${Date.now()}`;
  const admin = new Pool({ connectionString: BASE_URL });

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

  try {
    // Apply every committed migration to the throwaway DB — same entry point the
    // deploy gate and app boot use.
    execFileSync("tsx", ["script/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: tempUrlStr, NODE_ENV: "test" },
      encoding: "utf-8",
    });

    // Point the real storage's pool at the throwaway DB. Must happen before the
    // dynamic import: server/db.ts reads process.env.DATABASE_URL when its Pool
    // is constructed at module load.
    process.env.DATABASE_URL = tempUrlStr;
    const { storage } = await import("../server/storage");

    // Helper: seed one row and return its id. resolvedAt/resolvedBy are stamped
    // separately via the real resolve path so we exercise the same code the app
    // uses rather than hand-writing the columns.
    async function seed(severity: string, source: string, summary: string, details: string | null = null) {
      const row = await storage.createErrorLog({
        severity, source, summary, details,
        userId: null, referenceType: null, referenceId: null,
      });
      return row.id;
    }

    async function severityOf(id: string) {
      return (await storage.getErrorLog(id))?.severity;
    }
    async function isResolved(id: string) {
      return (await storage.getErrorLog(id))?.resolvedAt != null;
    }
    async function exists(id: string) {
      return (await storage.getErrorLog(id)) != null;
    }

    await t.test("resolveAllErrorLogs honors severity filter, skips other severities and resolved rows", async () => {
      const errA = await seed("error", "push", "err push A");
      const errB = await seed("error", "email", "err email B");
      const warnC = await seed("warn", "push", "warn push C");
      // Pre-resolve one error row so we can prove it is left with its original
      // resolver (the update must skip already-resolved rows).
      await storage.setErrorLogResolved(errB, true, "earlier-admin");

      const n = await storage.resolveAllErrorLogs("admin-1", { severity: "error" });
      // Only errA was unresolved AND severity=error.
      assert.equal(n, 1);
      assert.equal(await isResolved(errA), true);
      assert.equal((await storage.getErrorLog(errA))?.resolvedBy, "admin-1");
      // Already-resolved error keeps its original resolver, not overwritten.
      assert.equal((await storage.getErrorLog(errB))?.resolvedBy, "earlier-admin");
      // Non-matching severity untouched.
      assert.equal(await isResolved(warnC), false);
    });

    await t.test("resolveAllErrorLogs honors source + search filters together", async () => {
      const hit = await seed("error", "email", "smtp timeout", "connection reset");
      const wrongSource = await seed("error", "push", "smtp timeout", "connection reset");
      const wrongSearch = await seed("error", "email", "quota exceeded", null);

      const n = await storage.resolveAllErrorLogs("admin-2", { source: "email", search: "smtp" });
      assert.equal(n, 1);
      assert.equal(await isResolved(hit), true);
      assert.equal(await isResolved(wrongSource), false);
      assert.equal(await isResolved(wrongSearch), false);
    });

    await t.test("deleteAllErrorLogs honors source + resolved filters, leaves non-matching rows intact", async () => {
      const delMe = await seed("error", "discord", "webhook 500 A");
      const keepUnresolved = await seed("error", "discord", "webhook 500 B");
      const keepOtherSource = await seed("error", "route", "route boom");
      // Resolve keepUnresolved so a resolved:false filter must NOT delete it.
      await storage.setErrorLogResolved(keepUnresolved, true, "admin-x");

      const deleted = await storage.deleteAllErrorLogs({ source: "discord", resolved: false });
      // Only the unresolved discord row (delMe) matches.
      assert.equal(deleted, 1);
      assert.equal(await exists(delMe), false);
      assert.equal(await exists(keepUnresolved), true);
      assert.equal(await exists(keepOtherSource), true);
    });

    await t.test("deleteAllErrorLogs honors severity + search filters together", async () => {
      const delMe = await seed("fatal", "worker", "OOM killed", "heap exhausted");
      const wrongSeverity = await seed("warn", "worker", "OOM killed", "heap exhausted");
      const wrongSearch = await seed("fatal", "worker", "disk full", null);

      const deleted = await storage.deleteAllErrorLogs({ severity: "fatal", search: "OOM" });
      assert.equal(deleted, 1);
      assert.equal(await exists(delMe), false);
      assert.equal(await exists(wrongSeverity), true);
      assert.equal(await severityOf(wrongSeverity), "warn");
      assert.equal(await exists(wrongSearch), true);
    });

    // Ensure the pool opened by the imported storage module is closed so the
    // test subprocess can exit cleanly (see the e2e-http-harness-exit-hang note).
    const { pool } = await import("../server/db");
    await pool.end();
  } finally {
    // Drop lingering connections, then drop the throwaway DB.
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [tempName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${tempName}"`);
    await admin.end();
  }
});
