import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";

// End-to-end coverage for the idempotency of createWhmcsServiceAnnouncement.
//
// The storage method inserts the one-time "new service added" popup row with
// onConflictDoNothing on the UNIQUE (user_id, whmcs_service_id) index. That
// guarantee is what lets the WHMCS notifier retry a pass without ever showing a
// customer the same popup twice. A future schema change that dropped/relaxed
// that unique index would silently allow duplicates — this test fails loudly if
// that ever happens, because it exercises the REAL method against the REAL
// migrated schema (not a stub).
//
// Like test/audit-index-integration.test.ts it creates a throwaway database,
// applies every committed migration, points the storage layer at it (by setting
// DATABASE_URL before importing ./db + storage), and drops the DB at the end —
// the dev/CI database is never touched. Skips cleanly when DATABASE_URL is unset
// or the role can't CREATE DATABASE, so it never breaks the prebuild gate where
// it can't run.

const BASE_URL = process.env.DATABASE_URL;

test("createWhmcsServiceAnnouncement is idempotent on (user, service)", async (t) => {
  if (!BASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }

  const tempName = `sh_ann_idem_${process.pid}_${Date.now()}`;
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
    // Apply every committed migration to the throwaway DB (same entry point the
    // deploy gate + app boot use) so the UNIQUE index is really present.
    execFileSync("tsx", ["script/migrate.ts"], {
      env: { ...process.env, DATABASE_URL: tempUrlStr, NODE_ENV: "test" },
      encoding: "utf-8",
    });

    // Point the storage layer at the throwaway DB. ./db reads DATABASE_URL at
    // import time, so set it BEFORE the dynamic import. Each test file runs in
    // its own subprocess, so this mutation is isolated.
    process.env.DATABASE_URL = tempUrlStr;
    const { storage } = await import("../server/storage");
    const { pool } = await import("../server/db");

    try {
      const userId = "user-idem-1";
      const serviceId = 4242;

      // First insert creates the row.
      const first = await storage.createWhmcsServiceAnnouncement(userId, serviceId, "Web Hosting");
      assert.equal(first, true, "first insert reports success");

      // A retried pass with the SAME (user, service) must NOT throw and must NOT
      // create a second row — that's the whole idempotency contract.
      const second = await storage.createWhmcsServiceAnnouncement(userId, serviceId, "Web Hosting (renamed)");
      assert.equal(second, true, "retried insert still reports success (onConflictDoNothing)");

      const samePair = await pool.query(
        `SELECT count(*)::int AS n FROM whmcs_service_announcements WHERE user_id = $1 AND whmcs_service_id = $2`,
        [userId, serviceId],
      );
      assert.equal(samePair.rows[0].n, 1, "only ONE row exists for the (user, service) pair");

      // The original name is preserved (DO NOTHING never overwrites).
      const nameRow = await pool.query(
        `SELECT service_name FROM whmcs_service_announcements WHERE user_id = $1 AND whmcs_service_id = $2`,
        [userId, serviceId],
      );
      assert.equal(nameRow.rows[0].service_name, "Web Hosting", "conflict left the original row untouched");

      // A different service for the same user is a distinct alert → 2 rows total.
      const other = await storage.createWhmcsServiceAnnouncement(userId, 9999, "VPS");
      assert.equal(other, true);
      const total = await pool.query(
        `SELECT count(*)::int AS n FROM whmcs_service_announcements WHERE user_id = $1`,
        [userId],
      );
      assert.equal(total.rows[0].n, 2, "a different service id is a separate announcement");
    } finally {
      await pool.end();
    }
  } finally {
    process.env.DATABASE_URL = BASE_URL;
    await admin.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [tempName],
    );
    await admin.query(`DROP DATABASE IF EXISTS "${tempName}"`);
    await admin.end();
  }
});
