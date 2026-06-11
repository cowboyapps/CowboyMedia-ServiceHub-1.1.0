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

- **Tests ARE type-checked now.** `tsconfig.json` includes `test/**/*` and no longer excludes `**/*.test.ts`, so `npm run check` (and the prebuild gate) catches type drift in test files. Keep them honest against `shared/schema.ts`.
  **Why:** excluded tests could compile-rot silently until they crashed at runtime. **How to apply:** when a test mock is passed where a real type is expected (e.g. an Express `Response`), type the mock as `Response & { extra }` and cast the factory return `as unknown as MockRes` — import `Response` from `express`, NOT the global DOM `Response`, or `statusCode`/`status()` won't resolve. For `React.createElement(Component, props, ...children)` where the component's props require `children` (e.g. wouter's `Router`), pass children inside the props object — variadic children don't satisfy a required `children` prop and trigger TS2769.
