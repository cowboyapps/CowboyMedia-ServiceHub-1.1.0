---
name: e2e HTTP-server test harness exit hang / deadlock
description: Why an all-green-locally e2e test fails the VPS deploy gate as "timed out" — socket teardown AND sleep-based race sequencing both cause it; how to make the harness deterministic.
---

# e2e HTTP test "timed out" on the deploy gate — two distinct causes

Symptom signature: deploy `npm test` summary shows `N-1/N files passed` with the
one failure reading `<file> — timed out`, while that same file passes quickly in
isolation locally. The per-file watchdog (`TEST_FILE_TIMEOUT_MS`, default 180s)
killed a subprocess that either never exited or genuinely deadlocked.

## Cause 1: socket teardown (process never exits after green assertions)

A harness that spins up a real `http.Server` and cleans up with a bare,
un-awaited `server.close()` leaves keep-alive / half-aborted sockets open,
keeping the event loop alive. In the harness `finally`:
1. `server.closeAllConnections?.()` (Node 18.2+, optional-chain for older).
2. `await new Promise(r => server.close(() => r()))`.
3. `server.keepAliveTimeout = 1` as belt-and-suspenders.

## Cause 2: sleep-based sequencing of a gated in-flight write (true deadlock)

**This was the real recurring cause after Cause 1 was fixed.** Tests that hold a
handler "in flight" behind a gate promise and orchestrate abort/retry with fixed
sleeps (`await sleep(50); abort()`) deadlock under VPS CPU contention: if the
abort fires before the first request has claimed the idempotency key / entered
the gated write, the follow-up "retry" becomes the FIRST claimer and blocks
forever on a gate whose `release()` only runs after that same request returns.

**How to apply:** never sequence concurrent-request races with sleeps.
- Have the gated fake signal entry: `entered()` resolved inside the fake write;
  test does `await enteredP` before aborting — the write is *provably* in flight.
- After `release()`, don't sleep-then-assert the replay; poll until the guard
  stops answering 409 (bounded retry loop), then assert the replayed body.

Verify this class of fix by re-running the file under artificial CPU load
(a few `while :; do :; done &` spinners) — the run time stretching 2-3x
reproduces the VPS contention that flushes out the race.
