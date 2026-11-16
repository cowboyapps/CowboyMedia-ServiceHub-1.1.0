---
name: Optional chunk dependency measurement
description: Why apparent route splitting can still download optional libraries at startup
---

Measure startup using the full transitive static import graph, not just the
entry JavaScript file. Optional manually named chunks can absorb shared runtime
dependencies and consequently become required startup downloads.

**Why:** A route-splitting pass reduced the entry file but still loaded the full
editor and chart chunks because they contained runtime exports needed by the
entry. The entry size alone concealed that cost.

**How to apply:** When changing bundling or route loading, inspect the production
manifest and sum all statically imported chunks. Keep read-only helpers
independent of heavyweight editor modules.
Preserve runtime dependency ordering and verify a real build rather than
assuming a dynamic import guarantees a deferred transfer.

Prefer dependency-aware automatic chunking over partial vendor groups.

**Why:** Explicitly grouping chart/editor packages without their complete
dependency graphs caused vendor chunks to import initialization-time constants
back from the lazy Admin page. Opening Admin then threw a temporal-dead-zone
ReferenceError, despite passing type checks, source-component tests and bundling.
The earlier asset-cache fix addressed a different failure and did not solve it.

**How to apply:** Treat successful compilation as insufficient. Evaluate the
production ESM entry first, then import Admin before other lazy pages can
initialize its dependencies and mask a cycle. Keep this check before staged
artifact promotion. A DOM-backed module-initialization check does not verify
signed-in rendering or user interactions.
