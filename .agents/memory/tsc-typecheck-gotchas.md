---
name: tsc typecheck gotchas
description: Non-obvious things that make `npm run check` (tsc) behave unexpectedly on the ServiceHub codebase.
---

# `npm run check` (tsc) gotchas

- **Incremental cache lies.** tsc caches build state in `node_modules/typescript/tsbuildinfo`. After fixing errors, a re-run can report stale results. Always `rm -f node_modules/typescript/tsbuildinfo` before re-running `npm run check` to trust the count.
  **Why:** the cache made fixed errors keep showing / counts not drop. **How to apply:** any time you're iterating on tsc error counts.

- **Express 5 param values are `string | string[]`, not `string`.** `@types/express` 5's `ParamsDictionary` widens `req.params.X` and query values, so passing them straight into `string`-typed functions fails tsc. Use the `getParam(req, name): string` helper in `server/http-params.ts` (or `Array.isArray` guards) — do NOT loosen with `any`.
  **Why:** this was the bulk source of the 188-error backlog. **How to apply:** new route handlers reading params/query.

- **`target` must be ≥ ES2020** in `tsconfig.json` or Set/Map iteration triggers `--downlevelIteration` errors. Keep the `target` line.

- **Tests are excluded from typecheck.** `**/*.test.ts` are not type-checked by `tsc`, so type drift in test files (e.g. reading optional fields) won't fail `npm run check` — but it also won't be caught. Verify test runtime separately via `script/run-tests.ts`.
