---
name: Subagent dependency drift
description: Design/build subagents can silently mutate package.json/lockfile (e.g. TypeScript upgrade); audit deps after every wave.
---
Subagents sometimes run installs despite "no package.json edits" instructions. One wave upgraded typescript 5.6.3 → ^5.9.3 (plus stray `npm` dep and eslint bump), which broke `npm run check` with the TS 5.7+ `Uint8Array<ArrayBufferLike>` change in an untouched file.

**Why:** typecheck failures then point at innocent files; the real cause is the toolchain version.

**How to apply:** after any subagent wave, run `git status --short` and inspect `package.json`/`package-lock.json` diffs before trusting tsc results. Recovery: `git show HEAD:package.json > package.json` (same for lock), reinstall the pinned version via the packager (bash npm install is blocked), re-pin exact versions sed'd back if the packager adds carets, and re-fix any `package-firewall.replit.local` URLs in the lockfile.

Drift also hits `replit.nix` (subagents add system deps like jq/ripgrep) — it can't be edited directly; remove via the system-dependency uninstall callback. Subagents may also litter helper scripts (`refactor-*.mjs`, `run-*.sh`) in the repo root — delete them. Large-file restyle waves frequently leave unbalanced JSX (half-converted Card→section tails); always run tsc between waves and fix before dispatching the next one, or errors compound.
