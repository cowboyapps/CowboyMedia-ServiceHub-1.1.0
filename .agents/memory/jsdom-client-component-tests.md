---
name: jsdom client-component render tests (node:test + tsx)
description: Gotchas when writing jsdom render tests for client/src React components under tsx --test
---

# Writing jsdom render tests for client React components

When adding a `node:test` (tsx) test that mounts a React component from `client/src`
(pattern: `test/chat-composer.test.ts`, `test/messages-admin-gating.test.ts`):

## Classic-JSX needs `React` in scope
Under `tsx --test`, JSX compiles to classic `React.createElement(...)`. Components
that `import * as React from "react"` render fine. Components that rely on Vite's
automatic JSX runtime and do NOT import React (e.g. `client/src/lib/auth.tsx`,
`client/src/pages/messages-page.tsx`) throw `ReferenceError: React is not defined`
at render time.
**Fix in the test (do NOT edit the components or tsconfig):** after
`const React = await import("react")`, set `globalThis.React = React` (and
`window.React = React`) before importing those component modules. A free `React`
identifier resolves to the global, so this satisfies the classic transform.
**Why:** tsconfig `jsx` is `preserve`; esbuild/tsx falls back to the classic
runtime, and changing tsconfig would risk the Vite build.

## Radix dialogs need `MutationObserver` + a complete query stub
Mounting a tree that opens a Radix Dialog/Popover (focus-scope) throws
`ReferenceError: MutationObserver is not defined` — jsdom exposes it on `window`
but not as a bare global. Add `"MutationObserver"` to the BROWSER_GLOBALS copy
list. Separately, a dialog that fetches its own data (e.g. `UserProfileDialog`
reads `data.badges.some(...)`) will crash on a `{}` catch-all stub — serve the
real response shape (arrays present) for its endpoint, don't rely on the quiet
`return jsonResponse({})` fallback.

## Components that import `@assets/*` images need a loader stub
The `@assets` alias is Vite-only (it's NOT in tsconfig paths — only `@/*` and
`@shared/*` are). Under `tsx --test` Node can't import a `.png` as a module, so
any component pulling in an image (e.g. `brand-logo.tsx`, dragged in by
`auth-page.tsx`) dies with `ERR_MODULE_NOT_FOUND` before render.
**Fix in the test:** register a tiny ESM loader hook
(`test/helpers/asset-stub-loader.mjs`) that short-circuits `@assets/*`
specifiers to a `data:` module exporting `''`. Call
`register("./helpers/asset-stub-loader.mjs", import.meta.url)` (from
`node:module`) at the very top of the test, BEFORE the dynamic `await import`
of the component tree — registered hooks only affect later imports.

## Clean teardown so the suite doesn't hang
React Query's default `gcTime` (5 min) leaves a live timer after unmount that keeps
the node:test subprocess alive (exit blocked until killed). Set `gcTime: 0` on both
`queries` and `mutations` in the test's `QueryClient`, unmount in cleanup, and
`window.close()` in `after()`. Then the file exits 0 on its own.

**`queryClient.clear()` does NOT clear the MUTATION gc timer.** A test that fires a
`useMutation` (e.g. an order/POST) and then unmounts schedules a 5-min *mutation*
gc timer (`Mutation.scheduleGc` via observer unsubscribe). `clear()` clears query
gc but `MutationCache.remove()` never calls `mutation.destroy()`, so that timer
survives and pins the loop. When the test must drive the **singleton** `queryClient`
(the page seeds/invalidates against that exact instance, so a throwaway client with
`gcTime:0` would desync), collapse gcTime on the singleton for that run instead.
Per-file subprocess isolation makes this safe.

**Use the shared helper, not an inline override.** `test/helpers/component-test-teardown.ts`
exports `setupComponentTestTeardown({ queryClient, window })` — call it once at module
scope after the QueryClient is imported/created. It collapses queries+mutations
`gcTime` to 0, registers an `after` that `clear()`s + `window.close()`s, and (default
on) installs a long-timer guard that **fails the teardown loudly** if any long-lived
ref'd timer survives — turning a silent watchdog SIGKILL into an actionable assertion.
Precedent: `test/store-order-options.test.ts`, `test/admin-service-actions.test.ts`.
**Caveat — observer-less cache:** collapsing *queries* `gcTime` to 0 means any cache
entry with no active observer is GC'd immediately. A test that `setQueryData`s a
payload and reads it back via `getQueryData` WITHOUT a mounted observer (e.g. the
billing focus-refresh path in `test/billing-confirmation-banner.test.ts`) breaks under
`gcTime:0`. For those, pass `collapseQueryGcTime: false` (mutations still collapse) or
keep the plain `clear()/close()` teardown.

## Toasts block process exit (looks like an OOM/hang, isn't memory)
shadcn's toast store (`client/src/hooks/use-toast.ts`) schedules a removal
`setTimeout` with `TOAST_REMOVE_DELAY` (1_000_000ms ≈ 16min) on every dismiss and
**never `unref()`s it**. Any render test that surfaces even one toast leaves that
handle pending, so the `tsx --test` subprocess never exits: node:test prints each
`✔` but never reaches the final `ℹ tests N` summary, and the single-pass runner
SIGKILLs it (reported as a timeout/crash, easily mistaken for an OOM).
**Tell-tale:** the file passes one test at a time but hangs once a toast-firing
test is included; the per-test ms times are tiny but wall-clock runs to the
watchdog. **Fixed at the source:** `addToRemoveQueue` now `.unref()`s its removal
timer (no-op shape in the browser, where handles have no `unref`), so a toast no
longer pins the loop — no per-test harness workaround needed. An earlier
`unrefBigTimers` `globalThis.setTimeout` shim that unref'd any `delay >= 60_000`
timer ALSO masked React Query's gc timers; if you delete such a shim, handle the
gc timers separately (see the mutation-gc note above) or the file hangs again.

## Capturing test output in this environment
- The bash tool often returns `-1 / no output` for multi-file `tsx --test` runs even
  though the process keeps running. Workaround: launch with `setsid bash -c '... > /tmp/x.log 2>&1; echo EXIT:$? > /tmp/x.done' </dev/null & disown`,
  then poll the log/done files in separate short bash calls. Plain `nohup &` gets
  killed when the tool's shell exits; `setsid ... & disown` survives.
- When building the file list for `bash -c "...$FILES..."`, flatten it with
  `find ... | tr '\n' ' '` — embedded newlines split the `-c` string into multiple
  commands and you get `Permission denied` on a `.test.ts` path.
- **Large jsdom batches OOM-kill partway** in this container. The OOM is driven
  by node:test's *file-level concurrency* (default = `availableParallelism`, 8
  here): several jsdom files land in the same wave, each loading jsdom + the full
  React client tree into its own subprocess, and collectively exhaust memory.
  **Fix shipped:** `npm test` runs `script/run-tests.ts`, which runs every
  `*.test.ts` file in its own `tsx --test` subprocess **sequentially** (default
  `TEST_CONCURRENCY=1`, per-file `TEST_FILE_TIMEOUT_MS=180000`), so at most one
  heavy subprocess is resident and the whole suite runs as one batch (and in CI)
  without OOM. It prints an aggregated pass/fail summary and exits non-zero on
  any failure/hang. Pass file paths as args to run a subset. Each file runs in
  its own subprocess, so globals don't leak and a purely additive file can't
  regress others.
