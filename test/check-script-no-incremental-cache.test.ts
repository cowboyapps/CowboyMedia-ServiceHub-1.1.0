import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the build gate. The `check` script (run by `prebuild`
// and CI before every deploy) MUST NOT trust an incremental tsc cache: a stale
// `tsbuildinfo` can make plain `tsc` skip re-checking changed files and silently
// pass over a real type error. The fix runs `tsc --incremental false` so every
// type-check is from scratch.
//
// tsconfig.json sets `incremental: true` (kept so editors / one-off `tsc` runs
// stay fast), which means the ONLY thing standing between a stale cache and a
// masked type error reaching customers is the `--incremental false` flag on the
// `check` script. If someone reverts `check` back to plain `tsc` (or re-enables
// incremental on the flag), this test fails loudly.

function readScripts(): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

test("check script runs tsc", () => {
  const check = readScripts().check;
  assert.ok(check, "package.json must define a `check` script");
  assert.match(
    check,
    /\btsc\b/,
    `expected the \`check\` script to invoke tsc, got: ${check}`,
  );
});

test("check script does not trust an incremental tsc cache", () => {
  const check = readScripts().check ?? "";

  // Must explicitly disable incremental so a stale tsbuildinfo can't mask a
  // type error. Accept either `--incremental false` or `--incremental=false`.
  assert.match(
    check,
    /--incremental[ =]false/,
    `the \`check\` script must disable the incremental cache (expected ` +
      `\`--incremental false\`) so a stale tsbuildinfo cannot mask a type ` +
      `error; got: ${check}`,
  );

  // Guard against the cache-trusting reverts: bare `tsc` with no flag, or
  // `--incremental true` / `--incremental=true`.
  assert.doesNotMatch(
    check,
    /--incremental[ =]true/,
    `the \`check\` script must not re-enable the incremental cache; got: ${check}`,
  );
});
