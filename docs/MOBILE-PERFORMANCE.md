# Mobile performance comparison

Measured on November 12, 2026. This pass changes loading and unnecessary work,
not ServiceHub's branding or page layouts. Version remains 9.5.

## Results

| Fixed workload | Before | After |
| --- | ---: | ---: |
| Initial JavaScript, including all static dependencies | 2,246,976 bytes | 890,529 bytes |
| Same JavaScript, gzip estimate | 640,595 bytes | 265,712 bytes |
| Additional JavaScript for dashboard → alerts list | 0 bytes | 0 bytes |
| Additional JavaScript for first alert-detail visit, gzip | 0 bytes (already downloaded upfront) | 4,137 bytes |
| On-demand page modules | 1 | 19 |
| History polling requests in a 60-second healthy-socket fixture, excluding initial load | 12 | 2 |
| History polling requests in the same disconnected-socket fixture | 12 | 12 |
| Independent recurring timers for the four shared unread queries across layout, sidebar and bottom navigation | 12 | 4 |
| Private conversation, 150 messages / 50 video cards / 10 typed characters: median React update render | 92.85 ms | 1.12 ms |
| Same conversation: total React update render time across 11 commits | 1,014.41 ms | 13.49 ms |

Initial JavaScript is **58.5% smaller by estimated gzip transfer**, or 60.4%
smaller uncompressed. The bundle figures count the complete static import graph;
looking only at the entry filename understates startup cost.

The conversation measurements are development React Profiler results in jsdom on
this container, not physical Pixel, Galaxy or iPhone frame-rate measurements.
They demonstrate removal of repeated bubble rendering while typing; they do not
promise a particular phone response time. Other messages in this fixture contain
long HTTPS links. Videos remain lightweight cards until opened.

Request counts are from a deterministic React Query scheduler replay, not a
production network trace. It advances 60 foreground seconds, then invalidates the
query to emulate a socket update and checks that the fetch happens immediately.
It also verifies hidden-window polling is suppressed. Badge timer consolidation
reduces scheduling work; it is **not** claimed to reduce requests by two thirds,
because React Query already deduplicates overlapping requests.

The alerts list stays eager because quick access to service health matters.
Opening a detail page now downloads a small additional chunk once rather than
making every customer download every detail screen at startup. API data caching
for the dashboard/alerts is unchanged. The private conversation list no longer
polls or requests list-only legacy/admin data while a conversation is open.

## Changes and safeguards

- Secondary pages download only when opened, with accessible loading feedback and
  an in-place retry for failed downloads. No broad prefetching.
- Read-only HTML helpers no longer import the editor. Explicit optional chunk
  boundaries prevent shared React dependencies from forcing charts/editor
  downloads at startup.
- One layout owner polls the shared unread counts at the same 15-second cadence;
  both navigation views continue observing those cache entries.
- Ticket and private-message sockets retain their immediate change handling,
  five-second disconnected fallback, reconnect/resume catch-up, and a
  thirty-second healthy-connection safety poll. A silently missed frame can take
  up to thirty seconds to reconcile while the socket still appears open.
- Private-message history JSX is reused during composer typing and upload
  progress, but refreshes when messages, receipts, permissions, reactions, or
  sending state change. No history virtualization or pagination was added.
- Existing support-ticket row memoization and scroll-following behavior remain.
- No changes to authentication, billing, attachment limits/storage/access,
  retention, permissions, version, or the two-second splash plus fade.

## Reproduce

Use the same Node/dependency versions and identical fixtures on both source
revisions. These commands compile only the client; they do not replace the full
deployment gates.

```sh
npx vite build --outDir /tmp/servicehub-client-measurement --manifest
npx tsx script/measure-client-bundle.ts /tmp/servicehub-client-measurement
npx tsx --test --test-name-pattern='performance fixture' test/messages-admin-gating.test.ts
npx tsx --test test/conversation-polling.test.ts
```

For the original conversation baseline, use the pre-optimization conversation
component with the same profiler fixture. The checked-in fixture now also
verifies that cached edits still update the rendered message and its edited label.

Verification: 63 focused tests passed across nine files, including lazy-route
loading/retry/direct links, polling, customer/admin message actions, edits, read
visibility, retries, deletions, keyboard layout, scroll following, and alert
rendering. Full TypeScript and application ESLint checks passed. The production
client build passed. The application restarted successfully on port 5000;
the 390×844 guest screenshot captured the unchanged splash, not authenticated
dashboard or messaging screens. Those components were checked with render tests.

## Remaining opportunities

The splash video is still approximately 2.65 MB before browser caching, and
some application/runtime code still loads at startup. These were not replaced
or cosmetically changed. Production API latency, server/database load and
real-device animation/keyboard performance were not measured in this pass.
No production configuration changes, Git pushes, or deployment were performed.
