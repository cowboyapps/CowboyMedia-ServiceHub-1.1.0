import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const updater = await readFile("deploy/update.sh", "utf8");
// Exercise the actual single-quoted shell body, not a reimplementation. Only
// replace sudo/login-shell setup; all install/retry/build/error logic is real.
const helper = updater.slice(updater.indexOf("run_build_as_app_user() {"),
  updater.indexOf("\nINNER\n}") + "\nINNER\n}".length)
  .replace('sudo -u "$APP_USER" -H bash -l -s', "bash -s");
const failureBranch = updater.slice(updater.indexOf("if ! run_build_as_app_user; then"),
  updater.indexOf('\necho "==> Updating scoped private-message'));

for (const scenario of ["install", "signature", "gate", "success", "retry-success"] as const) {
  test(`update helper handles ${scenario} without losing the working artifacts`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "servicehub-update-test-"));
    try {
      await mkdir(path.join(root, "bin"));
      await mkdir(path.join(root, "dist"));
      await writeFile(path.join(root, ".env"), "# no production credentials used\n");
      await writeFile(path.join(root, "dist/index.cjs"), "old server");
      await writeFile(path.join(root, "dist/index.html"), "old client");
      await writeFile(path.join(root, "bin/npm"), `#!/usr/bin/env bash
set -eu
echo "$*" >> "$APP_DIR/commands"
case "$1" in
  ci)
    mkdir -p node_modules/.bin
    for b in eslint tsc tsx drizzle-kit vite esbuild; do
      printf '#!/bin/sh\\nexit 0\\n' > "node_modules/.bin/$b"
      chmod +x "node_modules/.bin/$b"
    done
    if [[ "$SCENARIO" == install ]]; then exit 1; fi
    if [[ "$SCENARIO" == signature ]]; then echo 'Exit handler never called!'; fi
    if [[ "$SCENARIO" == retry-success && ! -f retry ]]; then touch retry; exit 1; fi
    ;;
  run)
    [[ "$NODE_ENV" == test ]] || exit 88
    if [[ "$SCENARIO" == gate ]]; then exit 1; fi
    ;;
esac
`, { mode: 0o755 });
      const run = spawnSync("bash", ["-c", `
set -euo pipefail
APP_DIR="$1"; ENV_FILE="$APP_DIR/.env"; APP_USER=unused; PREV_SHA=previous
export APP_DIR
sudo() { printf '%s\\n' "$*" >> "$APP_DIR/resets"; }
${helper}
${failureBranch}
echo reload-allowed > "$APP_DIR/passed"
`, "--", root], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, SCENARIO: scenario },
      });
      assert.ifError(run.error);
      const passed = scenario === "success" || scenario === "retry-success";
      assert.equal(run.status, passed ? 0 : 1, run.stdout + run.stderr);
      assert.equal(await readFile(path.join(root, "dist/index.cjs"), "utf8"), "old server");
      assert.equal(await readFile(path.join(root, "dist/index.html"), "utf8"), "old client");
      const commands = await readFile(path.join(root, "commands"), "utf8");
      assert.equal(commands.split("\n").filter((line) => line.startsWith("ci ")).length,
        scenario === "gate" || scenario === "success" ? 1 : 2);
      if (scenario === "install" || scenario === "signature") {
        assert.doesNotMatch(commands, /run build/);
      }
      if (passed) {
        assert.equal(await readFile(path.join(root, "passed"), "utf8"), "reload-allowed\n");
      } else {
        assert.match(await readFile(path.join(root, "resets"), "utf8"), /reset --hard previous/);
        assert.match(run.stdout, /PM2 was NOT reloaded/);
      }
      assert.doesNotMatch(failureBranch, /pg_restore|pm2 reload|FORCE_DEPLOY/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
