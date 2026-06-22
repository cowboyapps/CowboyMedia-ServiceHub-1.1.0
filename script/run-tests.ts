// Reliable test runner: per-group concurrency + resumable/budgeted runs.
//
// Why this exists: the whole suite (120+ `*.test.ts` files) used to be handed to
// one `tsx --test` invocation. node:test's default file concurrency equals the
// CPU count (8 here), so up to 8 jsdom-based React render tests would spin up
// simultaneously and OOM-kill the runner partway through — losing all buffered
// output and the final summary. That made it impossible to confirm a green run
// and risked masking real failures.
//
// This runner spawns one `tsx --test` child process PER FILE so each file runs
// in isolation (the case we verified never OOMs) and a per-file watchdog kills
// any process that hangs. Results from every file are aggregated into a single
// pass/fail summary that always prints; the process exits non-zero on any
// failure/crash/timeout.
//
// Two refinements make the *full* suite runnable end-to-end inside the Replit
// container (where a single shell command is time-boxed and detached background
// runs get reaped):
//
//   1. Per-group concurrency. Files are classified into "heavy" (jsdom/React
//      render tests — memory hungry) and "light" (plain server/shared logic).
//      Light files run at higher concurrency (fast, cheap); heavy files run
//      sequentially by default so we never re-introduce the OOM.
//
//   2. Resumable + time-budgeted runs. With --resume the runner records every
//      file that passes (keyed by mtime) to a cache file and skips already-green
//      files on the next invocation. With TEST_TIME_BUDGET_MS it stops launching
//      new files once the budget is spent, finishes in-flight work, and exits 2
//      ("incomplete — re-run to resume"). Together they let you walk the whole
//      suite to green across several short commands.
//
// Usage:
//   tsx script/run-tests.ts                          # run everything
//   tsx script/run-tests.ts test/foo.test.ts ...     # run a subset
//   tsx script/run-tests.ts --resume                 # skip files that already passed
//   TEST_TIME_BUDGET_MS=90000 tsx script/run-tests.ts --resume   # chunked, resumable
//   tsx script/run-tests.ts --reset                  # clear resume progress, then run
//
// Env:
//   TEST_CONCURRENCY        heavy (jsdom) parallel children (default 1). Keep low
//                           — each jsdom child can use a few hundred MB; the
//                           original OOM was 8 at once.
//   TEST_CONCURRENCY_LIGHT  light (non-jsdom) parallel children (default 4).
//   TEST_FILE_TIMEOUT_MS    per-file watchdog in ms (default 180000 = 3 min).
//   TEST_TIME_BUDGET_MS     overall soft budget; stop scheduling new files once
//                           exceeded and exit 2 if any remain (default: none).
//   TEST_RESUME=1           same as --resume.
//   TEST_RESET=1            same as --reset.
//   TEST_PROGRESS_FILE      resume cache path (default node_modules/.cache/servicehub-test-progress.json).

import { spawn } from "node:child_process";
import {
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { dirname, join } from "node:path";

const SEARCH_DIRS = ["test", "shared", "server"];
const HEAVY_CONCURRENCY = Math.max(1, Number(process.env.TEST_CONCURRENCY) || 1);
const LIGHT_CONCURRENCY = Math.max(
  1,
  Number(process.env.TEST_CONCURRENCY_LIGHT) || 4,
);
const FILE_TIMEOUT_MS = Math.max(
  10_000,
  Number(process.env.TEST_FILE_TIMEOUT_MS) || 180_000,
);
const TIME_BUDGET_MS = Math.max(0, Number(process.env.TEST_TIME_BUDGET_MS) || 0);
const PROGRESS_FILE =
  process.env.TEST_PROGRESS_FILE ||
  join("node_modules", ".cache", "servicehub-test-progress.json");

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith("-")));
const RESUME = FLAGS.has("--resume") || process.env.TEST_RESUME === "1";
const RESET = FLAGS.has("--reset") || process.env.TEST_RESET === "1";

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

// Heavy = pulls in jsdom (React component render tests). These are the memory
// hogs that must stay (near-)sequential. Everything else is light server/shared
// logic that parallelises safely.
function isHeavy(file: string): boolean {
  try {
    return readFileSync(file, "utf8").includes("jsdom");
  } catch {
    return false;
  }
}

function mtimeMs(file: string): number {
  try {
    return Math.floor(statSync(file).mtimeMs);
  } catch {
    return 0;
  }
}

interface Progress {
  version: number;
  passed: Record<string, number>; // file -> mtimeMs when it last passed
}

function loadProgress(): Progress {
  try {
    const raw = JSON.parse(readFileSync(PROGRESS_FILE, "utf8"));
    if (raw && typeof raw === "object" && raw.passed) return raw as Progress;
  } catch {
    /* no/garbage progress file — start fresh */
  }
  return { version: 1, passed: {} };
}

function saveProgress(p: Progress): void {
  try {
    mkdirSync(dirname(PROGRESS_FILE), { recursive: true });
    writeFileSync(PROGRESS_FILE, JSON.stringify(p));
  } catch {
    /* best-effort cache; a failure here must not fail the run */
  }
}

function clearProgress(): void {
  try {
    rmSync(PROGRESS_FILE, { force: true });
  } catch {
    /* ignore */
  }
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
    const child = spawn("tsx", ["--test", "--test-reporter=spec", file], {
      env: { ...process.env, NODE_ENV: "test" },
      stdio: ["ignore", "pipe", "pipe"],
    });

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

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;
      const tests = parseCount(output, "tests");
      const pass = parseCount(output, "pass");
      const fail = parseCount(output, "fail");
      let status: FileResult["status"];
      if (timedOut) status = "timeout";
      else if (code === 0) status = "pass";
      else if (fail > 0) status = "fail";
      else status = "crash"; // non-zero exit, no parsed failures (load error / OOM)
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
  if (RESET) {
    clearProgress();
    console.log("Cleared resume progress.\n");
  }

  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const allFiles = (
    argv.length > 0 ? argv : SEARCH_DIRS.flatMap(findTestFiles)
  ).sort();

  if (allFiles.length === 0) {
    console.error("No *.test.ts files found.");
    process.exit(1);
  }

  const progress = RESUME ? loadProgress() : { version: 1, passed: {} };

  // Skip files that already passed (resume) at their current mtime.
  const skipped: string[] = [];
  const pending = allFiles.filter((f) => {
    if (RESUME && progress.passed[f] === mtimeMs(f)) {
      skipped.push(f);
      return false;
    }
    return true;
  });

  // Split remaining work into light (parallel) and heavy (sequential) groups.
  const heavy = pending.filter(isHeavy);
  const light = pending.filter((f) => !heavy.includes(f));

  const startedAt = Date.now();
  const budgetSpent = () =>
    TIME_BUDGET_MS > 0 && Date.now() - startedAt >= TIME_BUDGET_MS;

  console.log(
    `Test files: ${allFiles.length} total` +
      (RESUME ? `, ${skipped.length} already green (skipped)` : "") +
      `, ${pending.length} to run (${light.length} light @${LIGHT_CONCURRENCY}, ${heavy.length} heavy @${HEAVY_CONCURRENCY}), ` +
      `per-file timeout=${Math.round(FILE_TIMEOUT_MS / 1000)}s` +
      (TIME_BUDGET_MS > 0
        ? `, time budget=${Math.round(TIME_BUDGET_MS / 1000)}s`
        : "") +
      "\n",
  );

  const results: FileResult[] = [];
  let completed = 0;
  let budgetHit = false;
  const totalToRun = pending.length;

  // Run one group with a bounded pool of workers. Returns false if it bailed
  // early because the time budget was spent.
  async function runGroup(
    files: string[],
    concurrency: number,
  ): Promise<void> {
    let cursor = 0;
    async function worker() {
      while (cursor < files.length) {
        if (budgetSpent()) {
          budgetHit = true;
          return;
        }
        const file = files[cursor++];
        const res = await runFile(file);
        results.push(res);
        completed++;
        if (res.status === "pass") {
          progress.passed[file] = mtimeMs(file);
          if (RESUME) saveProgress(progress); // persist after every green file
        }
        const icon =
          res.status === "pass" ? "✔" : res.status === "timeout" ? "⏱" : "✖";
        const detail =
          res.status === "timeout"
            ? "TIMED OUT"
            : res.status === "crash"
              ? "CRASHED (no summary)"
              : `${res.pass} pass, ${res.fail} fail`;
        console.log(
          `${icon} [${completed}/${totalToRun}] ${file} — ${detail} (${(
            res.durationMs / 1000
          ).toFixed(1)}s)`,
        );
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
    const workers = Array.from(
      { length: Math.min(concurrency, files.length) },
      () => worker(),
    );
    await Promise.all(workers);
  }

  // Light first (cheap, fast wins), then heavy. Budget check guards both.
  await runGroup(light, LIGHT_CONCURRENCY);
  if (!budgetSpent()) await runGroup(heavy, HEAVY_CONCURRENCY);
  else budgetHit = budgetHit || heavy.length > 0;

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
  const remaining = totalToRun - results.length;

  console.log("\n" + "=".repeat(60));
  console.log("Test suite summary");
  console.log("=".repeat(60));
  console.log(`Files discovered : ${allFiles.length}`);
  if (RESUME) console.log(`Files skipped    : ${skipped.length} (already green)`);
  console.log(`Files run        : ${results.length}`);
  console.log(`Files passed     : ${results.length - failedFiles.length}`);
  console.log(`Files failed     : ${failedFiles.length}`);
  if (remaining > 0) console.log(`Files remaining  : ${remaining} (not run)`);
  console.log(`Tests total      : ${totals.tests}`);
  console.log(`Tests passed     : ${totals.pass}`);
  console.log(`Tests failed     : ${totals.fail}`);

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

  if (budgetHit && remaining > 0) {
    console.log(
      `\nTime budget reached — ${remaining} file(s) not yet run. ` +
        `Re-run with --resume to continue where this left off.`,
    );
    process.exit(2);
  }

  // Full clean pass over everything that was discovered → clear resume cache.
  if (RESUME && remaining === 0 && argv.length === 0) clearProgress();

  console.log("\nAll test files passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error("run-tests.ts crashed:", err);
  process.exit(1);
});
