import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { withStagedBuild } from "../script/staged-build";

const project = process.cwd();

async function write(root: string, file: string, contents: string) {
  await mkdir(path.dirname(path.join(root, file)), { recursive: true });
  await writeFile(path.join(root, file), contents);
}

async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const [file, contents] of Object.entries(await tree(path.join(root, entry.name)))) {
        result[`${entry.name}/${file}`] = contents;
      }
    } else {
      result[entry.name] = (await readFile(path.join(root, entry.name))).toString("base64");
    }
  }
  return result;
}

async function seedOldBuild(root: string) {
  for (const file of ["public/index.html", "public/sw.js", "public/assets/old.js", "index.cjs", ".git-sha"]) {
    await write(root, `dist/${file}`, `previous working ${file}`);
  }
  return tree(path.join(root, "dist"));
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "servicehub-build-test-"));
  await symlink(path.join(project, "node_modules"), path.join(root, "node_modules"), "dir");
  await write(root, "package.json", JSON.stringify({ type: "module", dependencies: {} }));
  await write(root, "vite.config.ts", `export default {
    root: "client", build: { outDir: "../dist/public", emptyOutDir: true }
  };`);
  await write(root, "client/index.html", '<html><body><script type="module" src="/main.js"></script></body></html>');
  await write(root, "client/main.js", 'console.log("new client");');
  await write(root, "client/public/sw.js", 'const BUILD_ID = "__BUILD_ID__";');
  await write(root, "server/index.ts", 'console.log("new server");');
  await mkdir(path.join(root, "script"));
  for (const file of ["build.ts", "staged-build.ts"]) {
    await copyFile(path.join(project, "script", file), path.join(root, "script", file));
  }
  await mkdir(path.join(root, "deploy/webhook-listener"), { recursive: true });
  await copyFile(path.join(project, "deploy/webhook-listener/build-diagnostics.mjs"),
    path.join(root, "deploy/webhook-listener/build-diagnostics.mjs"));
  execFileSync("git", ["init", "-q", root]);
  execFileSync("git", ["-C", root, "-c", "user.name=Build Test", "-c", "user.email=build@example.invalid",
    "commit", "--allow-empty", "-qm", "fixture"]);
  return root;
}

for (const failure of ["client", "server", "missing-sw", "none", "first-build"] as const) {
  test(`real Vite/esbuild pipeline: ${failure}`, async () => {
    const root = await fixture();
    try {
      const old = failure === "first-build" ? undefined : await seedOldBuild(root);
      if (failure === "client") await write(root, "client/main.js", "export const broken = ;");
      if (failure === "server") await write(root, "server/index.ts", "export const broken = ;");
      if (failure === "missing-sw") await rm(path.join(root, "client/public/sw.js"));
      const run = spawnSync(path.join(project, "node_modules/.bin/tsx"), ["script/build.ts"], {
        cwd: root, encoding: "utf8", timeout: 30_000,
      });
      assert.ifError(run.error);
      if (failure !== "none" && failure !== "first-build") {
        assert.notEqual(run.status, 0, run.stdout + run.stderr);
        assert.match(run.stderr, /\[build:error\]/, "staged failures retain concise deployment diagnostics");
        assert.deepEqual(await tree(path.join(root, "dist")), old);
        if (failure === "server") assert.match(run.stdout, /building server/);
      } else {
        assert.equal(run.status, 0, run.stdout + run.stderr);
        const built = await tree(path.join(root, "dist"));
        assert.ok(built["public/index.html"]);
        assert.ok(built["index.cjs"]);
        assert.ok(!built["public/assets/old.js"], "no stale client assets survive promotion");
        assert.match(await readFile(path.join(root, "dist/index.cjs"), "utf8"), /new server/);
        assert.doesNotMatch(await readFile(path.join(root, "dist/public/sw.js"), "utf8"), /__BUILD_ID__/);
        assert.equal((await readFile(path.join(root, "dist/.git-sha"), "utf8")).trim(),
          execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
      }
      assert.deepEqual((await readdir(root)).filter((file) => file.startsWith(".build-")), []);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}

test("staged artifacts stay invisible until every check has passed", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "servicehub-build-test-"));
  try {
    const old = await seedOldBuild(root);
    await assert.rejects(withStagedBuild(async (candidate) => {
      await write(candidate, "public/index.html", "new client");
      await write(candidate, "public/sw.js", "stamped");
      await write(candidate, "index.cjs", ""); // incomplete server output
      assert.deepEqual(await tree(path.join(root, "dist")), old);
    }, root), /missing or empty: index.cjs/);
    assert.deepEqual(await tree(path.join(root, "dist")), old);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const restoreFails of [false, true]) {
  test(`failed promotion ${restoreFails ? "retains backup if restore also fails" : "restores previous build"}`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), "servicehub-build-test-"));
    const rename = fs.renameSync;
    const mocked = mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
      if (String(from).endsWith("/artifacts")) {
        // Simulate a filesystem/permission failure at the handoff.
        if (restoreFails) {
          fs.mkdirSync(path.join(root, "dist"));
          fs.writeFileSync(path.join(root, "dist/unexpected"), "concurrent writer");
        }
        throw new Error("promotion failed");
      }
      return rename(from, to);
    });
    syncBuiltinESMExports();
    try {
      const old = await seedOldBuild(root);
      await assert.rejects(withStagedBuild(async (candidate) => {
        await write(candidate, "public/index.html", "new client");
        await write(candidate, "public/sw.js", "stamped");
        await write(candidate, "index.cjs", "new server");
      }, root));
      const retained = (await readdir(root)).filter((file) => file.startsWith(".build-"));
      if (restoreFails) {
        assert.equal(retained.length, 1);
        assert.deepEqual(await tree(path.join(root, retained[0], "previous")), old);
      } else {
        assert.deepEqual(await tree(path.join(root, "dist")), old);
        assert.deepEqual(retained, []);
      }
    } finally {
      mocked.mock.restore();
      syncBuiltinESMExports();
      await rm(root, { recursive: true, force: true });
    }
  });
}
