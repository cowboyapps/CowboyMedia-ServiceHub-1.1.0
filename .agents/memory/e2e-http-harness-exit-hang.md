---
name: e2e HTTP-server test harness exit hang
description: Why an all-green e2e test can still fail the VPS deploy gate as "timed out", and how to make the harness exit deterministically.
---

# e2e HTTP test harness must tear down connections or the deploy gate kills it

A test that spins up a real `http.Server` (listen on port 0), fires requests
(especially aborted / keep-alive ones), and cleans up with a bare, un-awaited
`server.close()` can leave sockets open. Open sockets keep the Node event loop
alive, so the `tsx --test` subprocess never exits after the last assertion.

**Why:** the single-pass test runner enforces a per-file watchdog
(`TEST_FILE_TIMEOUT_MS`, default 180s). A subprocess that passes every
assertion but never exits gets killed and reported as "timed out". This can
pass fast locally yet blow the watchdog on the VPS deploy gate under build-time
CPU contention, where idle sockets linger longer — blocking a deploy on a test
that is actually green.

**How to apply:** in any test HTTP-server harness, in the `finally`:
1. Force-close open connections: `server.closeAllConnections?.()` (Node 18.2+,
   guard with optional chaining for older runtimes).
2. `await` a real shutdown: `await new Promise(r => server.close(() => r()))`.
3. Optionally set `server.keepAliveTimeout = 1` so idle keep-alive sockets die
   fast as belt-and-suspenders.

Symptom signature to recognize this class: deploy `npm test` summary shows
`N-1/N files passed` with the one failure line reading `<file> — timed out`,
while that same file passes quickly when run in isolation locally.
