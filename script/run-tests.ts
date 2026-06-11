// Reliable single-pass test runner.
//
// Why this exists: the whole suite (~53 `*.test.ts` files) used to be handed to
// one `tsx --test` invocation. node:test's default file concurrency equals the
// CPU count (8 here), so up to 8 jsdom-based React render tests would spin up
// simultaneously and OOM-kill the runner partway through — losing all buffered
// output and the final summary. That made it impossible to confirm a green run
// and risked masking real failures.
//
// This runner instead spawns one `tsx --test` child process PER FILE and walks
// them with a small, bounded concurrency (default 1 = fully sequential). Each
// file therefore runs in isolation just like `tsx --test <single-file>` does —
// the case we verified never OOMs — while a per-file watchdog kills any process
// that hangs so one stuck file can't stall the whole suite. Results from every
// file are aggregated into a single pass/fail summary that always prints, and
// the process exits non-zero if any file failed, crashed, or timed out.
//
// Usage:
//   tsx script/run-tests.ts                 # run everything, sequential
//   TEST_CONCURRENCY=2 tsx script/run-tests.ts
//   TEST_FILE_TIMEOUT_MS=180000 tsx script/run-tests.ts
//   tsx script/run-tests.ts test/foo.test.ts shared/bar.test.ts  # subset
//
// Env:
//   TEST_CONCURRENCY     parallel child processes (default 1). Keep low — each
//                        jsdom child can use a few hundred MB; the original OOM
//                        was caused by running 8 at once.
//   TEST_FILE_TIMEOUT_MS per-file watchdog in ms (default 180000 = 3 min).

import { spawn } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SEARCH_DIRS = ["test", "shared", "server"];
const CONCURRENCY = Math.max(1, Number(process.env.TEST_CONCURRENCY) || 1);
const FILE_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.TEST_FILE_TIMEOUT_MS) || 180_000,
);

function findTestFiles(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      out = out.concat(findTestFiles(full));
    } else if (entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

interface FileResult {
  file: string;
  tests: number;
  pass: number;
  fail: number;
  durationMs: number;
  status: "pass" | "fail" | "timeout" | "crash";
  output: string;
}

function parseCount(output: string, label: string): number {
  // node:test spec reporter prints lines like "ℹ pass 12". Take the last one.
  const re = new RegExp(`(?:ℹ\\s*)?${label}\\s+(\\d+)`, "g");
  let m: RegExpExecArray | null;
  let last: number | null = null;
  while ((m = re.exec(output)) !== null) last = Number(m[1]);
  return last ?? 0;
}

function runFile(file: string): Promise<FileResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(
      "tsx",
      ["--test", "--test-reporter=spec", file],
      {
        env: { ...process.env, NODE_ENV: "test" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let output = "";
    const collect = (buf: Buffer) => {
      output += buf.toString();
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, FILE_TIMEOUT_MS);

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const tests = parseCount(output, "tests");
      const pass = parseCount(output, "pass");
      const fail = parseCount(output, "fail");
      let status: FileResult["status"];
      if (timedOut) status = "timeout";
      else if (code === 0) status = "pass";
      else if (fail > 0) status = "fail";
      else status = "crash"; // non-zero exit with no parsed failures (e.g. load error / OOM)
      resolve({ file, tests, pass, fail, durationMs, status, output });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        file,
        tests: 0,
        pass: 0,
        fail: 0,
        durationMs: Date.now() - start,
        status: "crash",
        output: `failed to spawn tsx: ${String(err)}`,
      });
    });
  });
}

async function main() {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const files = (
    argv.length > 0 ? argv : SEARCH_DIRS.flatMap(findTestFiles)
  ).sort();

  if (files.length === 0) {
    console.error("No *.test.ts files found.");
    process.exit(1);
  }

  console.log(
    `Running ${files.length} test file(s) with concurrency=${CONCURRENCY}, ` +
      `per-file timeout=${Math.round(FILE_TIMEOUT_MS / 1000)}s\n`,
  );

  const results: FileResult[] = [];
  let cursor = 0;
  let completed = 0;

  async function worker() {
    while (cursor < files.length) {
      const idx = cursor++;
      const file = files[idx];
      const res = await runFile(file);
      results.push(res);
      completed++;
      const icon =
        res.status === "pass"
          ? "✔"
          : res.status === "timeout"
            ? "⏱"
            : "✖";
      const detail =
        res.status === "timeout"
          ? "TIMED OUT"
          : res.status === "crash"
            ? "CRASHED (no summary)"
            : `${res.pass} pass, ${res.fail} fail`;
      console.log(
        `${icon} [${completed}/${files.length}] ${file} — ${detail} (${(
          res.durationMs / 1000
        ).toFixed(1)}s)`,
      );
      // Echo full child output for anything that didn't cleanly pass so
      // failures/crashes are never hidden behind the summary line.
      if (res.status !== "pass") {
        console.log(
          res.output
            .split("\n")
            .map((l) => "    " + l)
            .join("\n"),
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, files.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  results.sort((a, b) => a.file.localeCompare(b.file));

  const totals = results.reduce(
    (acc, r) => {
      acc.tests += r.tests;
      acc.pass += r.pass;
      acc.fail += r.fail;
      return acc;
    },
    { tests: 0, pass: 0, fail: 0 },
  );

  const failedFiles = results.filter((r) => r.status !== "pass");

  console.log("\n" + "=".repeat(60));
  console.log("Test suite summary");
  console.log("=".repeat(60));
  console.log(`Files run     : ${results.length}`);
  console.log(`Files passed  : ${results.length - failedFiles.length}`);
  console.log(`Files failed  : ${failedFiles.length}`);
  console.log(`Tests total   : ${totals.tests}`);
  console.log(`Tests passed  : ${totals.pass}`);
  console.log(`Tests failed  : ${totals.fail}`);

  if (failedFiles.length > 0) {
    console.log("\nFailing files:");
    for (const r of failedFiles) {
      const reason =
        r.status === "timeout"
          ? "timed out"
          : r.status === "crash"
            ? "crashed (no summary — possible OOM/load error)"
            : `${r.fail} failing test(s)`;
      console.log(`  ✖ ${r.file} — ${reason}`);
    }
    process.exit(1);
  }

  console.log("\nAll test files passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("run-tests.ts crashed:", err);
  process.exit(1);
});
