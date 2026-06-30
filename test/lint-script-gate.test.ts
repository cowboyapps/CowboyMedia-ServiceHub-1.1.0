import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Regression guard for the build gate. The `prebuild` script chains
// `lint -> check -> db:migrate -> db:check -> db:check:columns -> test` and runs
// before every deploy. If the `lint` step is accidentally removed, neutered
// (pointed at the wrong dirs / stops invoking eslint), or quietly dropped from
// the `prebuild` chain, the gate silently weakens and lint regressions can reach
// customers. This mirrors the type-check guard in
// `test/check-script-no-incremental-cache.test.ts`, but for the lint step (and,
// as defence in depth, the rest of the gate chain).

const EXPECTED_LINT_ROOTS = ["client/src", "server", "shared"] as const;

// Every step the `prebuild` gate must keep running, in order, before a deploy.
const EXPECTED_GATE_STEPS = [
  "lint",
  "check",
  "db:migrate",
  "db:check",
  "db:check:columns",
  "test",
] as const;

function readScripts(): Record<string, string> {
  const pkg = JSON.parse(
    readFileSync(join(process.cwd(), "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

test("lint script invokes eslint", () => {
  const lint = readScripts().lint;
  assert.ok(lint, "package.json must define a `lint` script");
  assert.match(
    lint,
    /\beslint\b/,
    `expected the \`lint\` script to invoke eslint, got: ${lint}`,
  );
});

test("lint script covers every expected source root", () => {
  const lint = readScripts().lint ?? "";

  for (const root of EXPECTED_LINT_ROOTS) {
    // Match the root as a whole shell token so `server` can't be satisfied by
    // an unrelated substring (and `client/src` can't be weakened to `client`).
    const tokenPattern = new RegExp(
      `(^|\\s)${root.replace(/[/]/g, "\\/")}(\\s|$)`,
    );
    assert.match(
      lint,
      tokenPattern,
      `the \`lint\` script must lint the \`${root}\` source root so lint ` +
        `regressions there can't reach customers; got: ${lint}`,
    );
  }
});

// Build the exact-command matcher for a single gate step. `test` runs as
// `npm test`; every other step runs as `npm run <step>`. The trailing
// `(?=\s|$)` boundary is what stops a renamed/alternate script from satisfying
// the guard: e.g. `npm run db:check` must NOT be matched by the
// `db:check:columns` invocation (the next char there is `:`, not whitespace or
// end), and `npm test` must NOT be matched by `npm run test:smoke`.
function gateStepPattern(step: string): RegExp {
  const command = step === "test" ? "npm test" : `npm run ${step}`;
  // Escape regex metacharacters in the command (e.g. the `:` in db:check).
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escaped}(?=\\s|$)`);
}

test("prebuild chain still runs every gate step as an exact command", () => {
  const prebuild = readScripts().prebuild;
  assert.ok(prebuild, "package.json must define a `prebuild` script");

  for (const step of EXPECTED_GATE_STEPS) {
    assert.match(
      prebuild,
      gateStepPattern(step),
      `the \`prebuild\` gate must still run the \`${step}\` step (as an exact ` +
        `command, not a renamed/alternate script) so it can't be quietly ` +
        `dropped from or weakened in the chain; got: ${prebuild}`,
    );
  }
});

test("prebuild gate steps stay in the contracted order", () => {
  const prebuild = readScripts().prebuild ?? "";

  let lastIndex = -1;
  let lastStep = "";
  for (const step of EXPECTED_GATE_STEPS) {
    const match = gateStepPattern(step).exec(prebuild);
    assert.ok(
      match,
      `the \`prebuild\` gate must still run the \`${step}\` step; got: ${prebuild}`,
    );
    assert.ok(
      match.index > lastIndex,
      `the \`prebuild\` gate must keep its steps in order ` +
        `(${EXPECTED_GATE_STEPS.join(" -> ")}); \`${step}\` appeared before ` +
        `\`${lastStep}\`; got: ${prebuild}`,
    );
    lastIndex = match.index;
    lastStep = step;
  }
});
