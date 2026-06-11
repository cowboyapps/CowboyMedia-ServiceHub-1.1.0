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

## Clean teardown so the suite doesn't hang
React Query's default `gcTime` (5 min) leaves a live timer after unmount that keeps
the node:test subprocess alive (exit blocked until killed). Set `gcTime: 0` on both
`queries` and `mutations` in the test's `QueryClient`, unmount in cleanup, and
`window.close()` in `after()`. Then the file exits 0 on its own.

## Capturing test output in this environment
- The bash tool often returns `-1 / no output` for multi-file `tsx --test` runs even
  though the process keeps running. Workaround: launch with `setsid bash -c '... > /tmp/x.log 2>&1; echo EXIT:$? > /tmp/x.done' </dev/null & disown`,
  then poll the log/done files in separate short bash calls. Plain `nohup &` gets
  killed when the tool's shell exits; `setsid ... & disown` survives.
- When building the file list for `bash -c "...$FILES..."`, flatten it with
  `find ... | tr '\n' ' '` — embedded newlines split the `-c` string into multiple
  commands and you get `Permission denied` on a `.test.ts` path.
- **Large jsdom batches OOM-kill partway** in this container. Running all ~53
  `*.test.ts` together dies mid-run (lost buffered output, no summary). Run jsdom
  tests in small batches (a few files) or per-file. Each file runs in its own
  node:test subprocess, so globals don't leak between files and a purely additive
  new test file can't regress others.
