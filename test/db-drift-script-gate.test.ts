import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the build gate. The `prebuild` script chains
// `lint -> check -> db:migrate -> db:check -> db:check:columns -> test` and runs
// before every deploy. The two database-drift steps are the last line of
// defence against schema drift reaching customers:
//   - `db:check`         — drizzle-kit's schema.ts-vs-migrations consistency check
//   - `db:check:columns` — the schema.ts-vs-live-DB column audit (script/audit-columns.ts)
//
// `test/lint-script-gate.test.ts` already guards that both steps stay *present*
// (and in order) in the `prebuild` chain. But presence isn't enough: if
// `db:check` is repointed away from `drizzle-kit check`, or `db:check:columns`
// stops invoking `script/audit-columns.ts`, the gate keeps "passing" while no
// longer detecting drift. This guard fails loudly if either drift step is
// retargeted or neutered. Mirrors the type-check guard in
// `test/check-script-no-incremental-cache.test.ts`.

function readScripts(): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

test("db:check script invokes drizzle-kit check", () => {
  const dbCheck = readScripts()["db:check"];
  assert.ok(dbCheck, "package.json must define a `db:check` script");

  // Must run drizzle-kit's `check` subcommand specifically — `drizzle-kit
  // generate`/`push`/etc. do NOT verify schema.ts against the migrations, so a
  // repoint to another subcommand would silently stop detecting drift.
  assert.match(
    dbCheck,
    /\bdrizzle-kit\s+check\b/,
    `the \`db:check\` step must run \`drizzle-kit check\` (the schema-vs-` +
      `migrations drift check) so schema drift can't reach customers; got: ${dbCheck}`,
  );
});

test("db:check:columns script runs script/audit-columns.ts", () => {
  const dbCheckColumns = readScripts()["db:check:columns"];
  assert.ok(
    dbCheckColumns,
    "package.json must define a `db:check:columns` script",
  );

  // Must invoke the column audit script specifically. Accept either a `/` or
  // `\` path separator so the guard isn't OS-specific.
  assert.match(
    dbCheckColumns,
    /script[/\\]audit-columns\.ts\b/,
    `the \`db:check:columns\` step must run \`script/audit-columns.ts\` (the ` +
      `schema-vs-live-DB column audit) so column drift can't reach customers; ` +
      `got: ${dbCheckColumns}`,
  );
});
