---
name: ESLint react-hooks setup
description: Why the ESLint hooks guard is pinned to specific versions and scoped narrowly.
---

# ESLint react-hooks guard

The repo lints `client/src/**` with a flat `eslint.config.js` enabling only
`react-hooks/rules-of-hooks` (catches the "hooks after an early return" white-screen
bug). `lint` script + `prebuild` gate run it.

## Server/shared coverage (type-aware block)
`server/**` + `shared/**` are linted with a **type-aware** `@typescript-eslint`
block, primarily for `no-floating-promises`/`no-misused-promises` (catch unawaited
DB writes / notification fan-outs — a lost-data class).

**Decision: fire-and-forget side effects are marked with `void`, never `await`ed.**
Notification helpers (push/email/discord/telegram, `notifyServiceSubscribers`),
background loops, startup IIFEs, and `setTimeout/setInterval(asyncFn)` are
intentionally not awaited (awaiting would block the HTTP response). Prefix `void`
to satisfy the rule — the idiom predates this block in `error-alerter.ts`.

**Gotcha — type-aware lint is cache-sensitive.** A stale
`node_modules/typescript/tsbuildinfo` made `npm run lint` pass locally while a clean
CI run flagged 4 real floating promises in `alert-routes.ts`. Before trusting a
green lint on type-aware rules, `rm -f node_modules/typescript/tsbuildinfo` and
re-run.

**Note:** `tsc`/`npm run check` has ~150 PRE-EXISTING errors (Express
`string | string[]`, Set downlevel-iteration) and is NOT in the build gate — the
lint block is independent and clean.

## Version pin — do not bump blindly
`eslint-plugin-react-hooks@^5` + `eslint@^9` + `@typescript-eslint/parser@^8`.

**Why:** the latest combo (plugin v7 + eslint v10) fails to even load the plugin:
its bundled code `require`s `zod-validation-error` subpath `./v4`, which the repo's
installed `zod-validation-error@3.5.4` does not export → `ERR_PACKAGE_PATH_NOT_EXPORTED`.
v5 of the plugin has no such transitive dep.

**How to apply:** if you upgrade eslint/react-hooks and lint suddenly errors at plugin
load (not at a rule), this transitive zod mismatch is the likely cause — stay on v5/v9
or resolve the zod-validation-error version conflict first.

## Rules enabled
- `react-hooks/rules-of-hooks` = error (white-screen guard).
- `react-hooks/exhaustive-deps` = warn (stale-data guard). Kept at *warn* on purpose:
  surfaces latent missing-dep issues without failing the build. Each intentional
  exception carries a one-line `// Keep:` justification above the disable comment.
- `reportUnusedDisableDirectives` = error. Because exhaustive-deps is now on, a stale
  `eslint-disable react-hooks/exhaustive-deps` that no longer suppresses anything fails
  lint — so don't leave dead disable comments behind.

**How to apply:** `npm run lint` passes with warnings present (exit 0 when 0 errors).
Don't blanket-suppress the warnings; fixing a dep array can change effect re-run
behavior, so review case-by-case. Before adding a disable, confirm it actually
suppresses a real warning or reportUnusedDisableDirectives will error.
