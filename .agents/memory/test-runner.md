---
name: Single-pass test runner
description: How the whole *.test.ts suite is run reliably (script/run-tests.ts) and why
---

# Running the full test suite

`npm test` → `tsx script/run-tests.ts`. The runner discovers every `*.test.ts`
under `test/`, `shared/`, `server/` and spawns **one `tsx --test` child process
per file**, walked with bounded concurrency (`TEST_CONCURRENCY`, default 1 =
sequential). A per-file watchdog (`TEST_FILE_TIMEOUT_MS`, default 180s) SIGKILLs
a stuck file. It aggregates pass/fail across all files, always prints a final
summary, and exits non-zero if any file fails/crashes/times out.

**Why this design.** The old `test` script handed all ~53 files to a single
`tsx --test` invocation. node:test's default file-concurrency = CPU count (8
here), so up to 8 jsdom React-render tests ran at once and OOM-killed the runner
mid-run — losing buffered output and the summary, masking real failures. One
file per child, sequentially, mirrors the `tsx --test <single-file>` case that
never OOMs. Each file is its own process, so globals don't leak between files.

**Why a custom runner instead of `--test-concurrency=1`.** Even a single
multi-file `tsx --test` invocation with concurrency=1 was unreliable for the
heavy jsdom files in this container; per-file child processes are bulletproof and
let a hang be killed + reported without stalling the whole suite.

## Environment gotchas when verifying long runs
- **Background processes do NOT survive between agent bash-tool calls** here
  (`setsid ... & disown` gets killed too — the old note claiming it survives is
  stale). And the bash tool caps at 120s, while the full suite takes longer.
  To verify, run subsets that each fit under ~120s (e.g. `server`+`shared` in
  one call, `test/` in another), or pass an explicit file list to the runner.
- A file that **passes but never exits** (missing `gcTime:0` on its test
  `QueryClient` — React Query's default 5-min cache timer keeps the node:test
  subprocess alive) is the classic single-pass staller. Fixed once on
  `test/chat-composer.test.ts`; check there first if the suite hangs on a file.

## Known pre-existing failures (not runnability bugs)
- `test/chat-reconnect-wiring.test.ts` has source-text assertions that grep the
  admin-portal page for `useReconnectingWebSocket({...}` wiring strings; the page
  was refactored and the strings no longer match (2 failing tests). These are
  real stale-test failures surfaced once the suite stopped OOMing — fix the
  assertions (or restore the wiring), don't paper over them.

**Resumable walk vs the 120s shell limit:** a `--resume` run whose next files are heavy jsdom tests can blow past the agent-shell 2-minute cap with ZERO output (the run is killed mid-file; that file records no progress, so retries loop forever). Recovery: read `node_modules/.cache/servicehub-test-progress.json` (`.passed` keys), diff against all `*.test.ts` files to list the remainder, then run the leftovers directly in ~3-file batches: `tsx script/run-tests.ts <file1> <file2> <file3>`.
