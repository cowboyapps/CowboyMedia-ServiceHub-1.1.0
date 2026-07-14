---
name: Design subagent diff verification
description: Checks to run after parallel DESIGN subagents restyle existing pages
---
Parallel DESIGN subagents restyling existing pages need mechanical post-checks — do not trust their completion messages.

**Why:** In one round, one subagent "completed" having changed nothing (returned early "to respect effort bounds"), and another deleted a function header (`function X() {`) leaving an orphaned body that broke tsc.

**How to apply:** After every subagent wave: (1) `git diff --stat` to confirm each target file actually changed; (2) full `tsc --incremental false` (a syntax orphan can hide anywhere in a 2000-line file); (3) diff-compare removed vs added `data-testid=` occurrences per file (`comm -23`) to catch lost test IDs; (4) re-dispatch a fresh subagent for no-op targets with an explicit "a previous attempt returned early — apply changes now, section by section" instruction, which worked.
