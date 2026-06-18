import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { extractUploadFilenamesFromHtml } from "../server/uploaded-file-cleanup";

/**
 * Pure set-difference at the heart of the recovery: given the filenames articles
 * still reference, the ones already present in the LIVE table, and the ones a
 * backup can supply, decide what to do. This is the logic that decides which
 * blobs get written to a production DB during a sensitive recovery, so it is
 * extracted and unit-tested separately from the two `pg.Pool`s it normally
 * reads from.
 *
 * - `missing`      = referenced − present-in-live   (candidates for recovery)
 * - `recoverable`  = missing ∩ present-in-backup    (we can re-insert these)
 * - `stillMissing` = missing − present-in-backup    (backup predates them too)
 *
 * `referenced` is de-duplicated while preserving first-seen order; the three
 * output lists inherit that order so logs/inserts are deterministic.
 */
export interface RecoverySelection {
  referenced: string[];
  missing: string[];
  recoverable: string[];
  stillMissing: string[];
}

export function computeRecoverySelection(
  referenced: Iterable<string>,
  presentInLive: Iterable<string>,
  presentInBackup: Iterable<string>,
): RecoverySelection {
  const referencedList = [...new Set(referenced)];
  const liveSet = new Set(presentInLive);
  const backupSet = new Set(presentInBackup);
  const missing = referencedList.filter((f) => !liveSet.has(f));
  const recoverable = missing.filter((f) => backupSet.has(f));
  const stillMissing = missing.filter((f) => !backupSet.has(f));
  return { referenced: referencedList, missing, recoverable, stillMissing };
}

/*
 * Recover knowledge-base / news images that the orphan sweep deleted before the
 * fix landed. The blobs were removed from `uploaded_files`, but the articles and
 * news stories still embed their `/uploads/<uuid>` paths in the HTML body — so we
 * can find exactly which blobs are missing and re-insert ONLY those rows from a
 * pre-deletion backup. This is deliberately NOT a full-database restore: it never
 * touches any table other than `uploaded_files`, and never overwrites a row that
 * already exists (ON CONFLICT DO NOTHING), so unrelated data can't be rolled back.
 *
 * Usage (run on the VPS, or anywhere both DBs are reachable):
 *
 *   1. Restore the pre-deletion backup into a SCRATCH database, e.g.
 *        createdb servicehub_backup
 *        pg_restore -d servicehub_backup pre-deletion.dump      # or: psql -d servicehub_backup -f backup.sql
 *   2. Point BACKUP_DATABASE_URL at that scratch DB and DATABASE_URL at LIVE.
 *   3. Dry-run first (default — reports, writes nothing):
 *        set -a; source /opt/servicehub/.env; set +a
 *        BACKUP_DATABASE_URL='postgres://.../servicehub_backup' npx tsx script/recover-kb-images.ts
 *   4. Apply once the report looks right:
 *        BACKUP_DATABASE_URL='postgres://.../servicehub_backup' npx tsx script/recover-kb-images.ts --apply
 *
 * Safe to run repeatedly: already-present blobs are skipped, so re-runs only fill
 * whatever is still missing.
 */

interface BlobRow {
  filename: string;
  mimetype: string;
  data: string;
  created_at: Date | string | null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const liveUrl = process.env.DATABASE_URL;
  const backupUrl = process.env.BACKUP_DATABASE_URL;

  if (!liveUrl) {
    console.error("DATABASE_URL (the LIVE database to recover into) is required.");
    console.error("On the VPS: set -a; source /opt/servicehub/.env; set +a");
    process.exit(1);
  }
  if (!backupUrl) {
    console.error("BACKUP_DATABASE_URL (a restored pre-deletion backup to read blobs from) is required.");
    console.error("Restore the backup into a scratch DB first, then point this at it. See the header of this file.");
    process.exit(1);
  }
  if (backupUrl === liveUrl) {
    console.error("BACKUP_DATABASE_URL must not equal DATABASE_URL — point it at a separate restored backup.");
    process.exit(1);
  }

  const live = new Pool({ connectionString: liveUrl });
  const backup = new Pool({ connectionString: backupUrl });

  try {
    // 1. Which /uploads/<file> paths do live articles/news still reference?
    const kb = await live.query<{ body_html: string }>("SELECT body_html FROM kb_articles");
    const news = await live.query<{ content: string }>("SELECT content FROM news_stories");
    const referenced = new Set<string>();
    for (const r of kb.rows) for (const f of extractUploadFilenamesFromHtml(r.body_html)) referenced.add(f);
    for (const r of news.rows) for (const f of extractUploadFilenamesFromHtml(r.content)) referenced.add(f);

    if (referenced.size === 0) {
      console.log("No /uploads/ image references found in any KB article or news story. Nothing to recover.");
      return;
    }

    // 2. Of those, which are missing from the LIVE uploaded_files table?
    const refList = [...referenced];
    const present = await live.query<{ filename: string }>(
      "SELECT filename FROM uploaded_files WHERE filename = ANY($1::text[])",
      [refList],
    );

    // 3. Pull whatever the backup can supply for the references, then let the
    //    pure selector compute the set differences (missing / recoverable /
    //    stillMissing) so the logic that decides what gets written is testable.
    const backupRows = await backup.query<BlobRow>(
      "SELECT filename, mimetype, data, created_at FROM uploaded_files WHERE filename = ANY($1::text[])",
      [refList],
    );
    const selection = computeRecoverySelection(
      refList,
      present.rows.map((r) => r.filename),
      backupRows.rows.map((r) => r.filename),
    );
    const recoverableSet = new Set(selection.recoverable);
    const recoverableRows = backupRows.rows.filter((r) => recoverableSet.has(r.filename));

    console.log(`Referenced upload files: ${refList.length}`);
    console.log(`Already present in live uploaded_files: ${refList.length - selection.missing.length}`);
    console.log(`Missing (candidates for recovery): ${selection.missing.length}`);
    console.log("");

    if (selection.missing.length === 0) {
      console.log("Every referenced image is already present. Nothing to recover.");
      return;
    }

    console.log(`Found in backup (recoverable): ${recoverableRows.length}`);
    for (const r of recoverableRows) console.log(`  + ${r.filename} (${r.mimetype})`);
    if (selection.stillMissing.length > 0) {
      console.log("");
      console.log(`NOT in backup either (${selection.stillMissing.length}) — this backup predates them or they were never stored:`);
      for (const f of selection.stillMissing) console.log(`  ? ${f}`);
    }
    console.log("");

    if (recoverableRows.length === 0) {
      console.log("Nothing in the backup matches the missing files. Try an earlier backup.");
      return;
    }

    if (!apply) {
      console.log("DRY RUN — no rows written. Re-run with --apply to insert the recoverable blobs above.");
      return;
    }

    // 4. Re-insert ONLY those rows into live. Never overwrite (idempotent).
    let inserted = 0;
    for (const r of recoverableRows) {
      const res = await live.query(
        `INSERT INTO uploaded_files (filename, mimetype, data, created_at)
         VALUES ($1, $2, $3, COALESCE($4, now()))
         ON CONFLICT (filename) DO NOTHING`,
        [r.filename, r.mimetype, r.data, r.created_at],
      );
      inserted += res.rowCount ?? 0;
    }
    console.log(`APPLIED — inserted ${inserted} uploaded_files row(s). Skipped ${recoverableRows.length - inserted} already-present.`);
    console.log("Reload an affected KB article to confirm its images render again.");
  } finally {
    await live.end();
    await backup.end();
  }
}

// Only run the DB-touching orchestration when invoked as the entrypoint, so the
// pure `computeRecoverySelection` above can be imported by tests without opening
// any pool or calling process.exit.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error("recover-kb-images failed:", e);
    process.exit(1);
  });
}
