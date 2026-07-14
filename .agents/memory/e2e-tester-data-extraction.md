---
name: e2e tester data extraction
description: How to get raw client-side debug state out of Playwright testing subagents that summarize instead of quoting
---
Testing subagents reliably perform flows but routinely IGNORE "paste this JSON verbatim in your report" instructions — they summarize instead, and the subagent is destroyed the moment runTest returns (message_subagent fails with "not found"). Screenshots are often not returned either.

**Rule:** never depend on the tester's report for raw data. Exfiltrate client state server-side: add a temporary `app.post("/api/__debug", ...)` route that `console.log`s the body, have the page POST a state snapshot after a fixed timeout (empty-dep effect + a ref updated every render for fresh values — an effect without a dep array re-arms its timer on every render and may never fire), then read it from the workflow logs. Give the tester only a trivial "keep the page open N seconds" job. Remove route + beacon after.

**Why:** three tester rounds in a row produced "successfully captured the debug JSON" with no JSON.
