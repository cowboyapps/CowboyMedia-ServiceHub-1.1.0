import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the post-merge schema reconcile step.
//
// scripts/post-merge.sh runs automatically after a task merges into the dev
// environment. It MUST reconcile the database by applying the committed
// migrations (`npm run db:migrate` -> script/migrate.ts -> runMigrations), NOT
// by running `drizzle-kit push` (scripts/db-sync.sh).
//
// WHY: `drizzle-kit push` applies shared/schema.ts to the DB but never writes
// the drizzle migration journal (drizzle.__drizzle_migrations). When a merged
// task adds a new table, push creates it WITHOUT journaling, so the next boot's
// migrator replays the same CREATE TABLE and crashes with
// `relation "<table>" already exists` (42P07). Running the journaling migrator
// instead keeps the journal in lockstep so boot stays a clean no-op. If someone
// reverts post-merge back to `db:push` / `db-sync.sh`, this test fails loudly.

function readPostMerge(): string {
  return readFileSync(join(process.cwd(), "scripts", "post-merge.sh"), "utf8");
}

// Strip comment bodies so the assertions match real commands, not the
// explanatory comment that (intentionally) mentions `db:push` / `db-sync.sh`.
function commandLines(script: string): string {
  return script
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
}

test("post-merge applies committed migrations via the journaling migrator", () => {
  const commands = commandLines(readPostMerge());
  assert.match(
    commands,
    /\bnpm run db:migrate\b/,
    `scripts/post-merge.sh must reconcile the dev DB with \`npm run db:migrate\` ` +
      `(the journaling migrator) so the migration journal stays in lockstep with ` +
      `the schema; got commands:\n${commands}`,
  );
});

test("post-merge does NOT use drizzle-kit push / db-sync.sh to reconcile schema", () => {
  const commands = commandLines(readPostMerge());

  assert.doesNotMatch(
    commands,
    /drizzle-kit\s+push/,
    `scripts/post-merge.sh must not run \`drizzle-kit push\` — it applies the ` +
      `schema without journaling, which strands the migration journal and crashes ` +
      `the next boot with "relation already exists"; got commands:\n${commands}`,
  );

  assert.doesNotMatch(
    commands,
    /db-sync\.sh/,
    `scripts/post-merge.sh must not invoke scripts/db-sync.sh (a bare ` +
      `\`drizzle-kit push --force\`) to reconcile schema; use \`npm run db:migrate\` ` +
      `so new tables are journaled; got commands:\n${commands}`,
  );
});
