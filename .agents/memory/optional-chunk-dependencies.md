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
manifest and sum all statically imported chunks. Keep optional chunk membership
explicit and keep read-only helpers independent of heavyweight editor modules.
Preserve runtime dependency ordering and verify a real build rather than
assuming a dynamic import guarantees a deferred transfer.
