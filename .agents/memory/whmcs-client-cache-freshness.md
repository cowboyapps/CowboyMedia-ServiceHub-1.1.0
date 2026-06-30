---
name: WHMCS-backed query freshness
description: Why WHMCS-backed (read-on-demand) screens go stale and how to keep them fresh on the client
---

WHMCS data (invoices, payments, products/services, profile) is read-on-demand straight from WHMCS — it is NOT persisted in Postgres, and there is no webhook when something changes in WHMCS (an invoice paid/deleted, a product cancelled). The server only caches the WHMCS read briefly (~60s).

The staleness users saw (e.g. an invoice deleted directly in WHMCS still showing days later) is therefore **client-side**: the app's global React Query defaults are `staleTime: Infinity` + `refetchOnWindowFocus: false` and no mount/reconnect refetch — so once a WHMCS-backed query is cached it is never revalidated.

**Rule:** any WHMCS-backed `useQuery` must opt into freshness, scoped — do NOT flip the global defaults (the rest of the app relies on infinite caching). Use the shared `liveQueryOptions` export in `client/src/lib/queryClient.ts` (`staleTime: 30_000` + `refetchOnMount/WindowFocus/Reconnect: true`) spread into the query.

**Why `true`, not `"always"`:** the finite `staleTime` is the actual fix (Infinity → never stale → never refetches). `true` triggers respect staleness, so re-navigating within 30s reuses just-loaded data while a resume/reopen after any real gap refetches. `"always"` refetches unconditionally and **breaks the jsdom render tests** (e.g. `test/my-services-empty-state.test.ts`) that prime the cache via `setQueryData` and stub `fetch` to return `{}` — the immediate refetch clobbers the primed data with empty.

**SW needs no change for this:** `client/public/sw.js` `handleApi` is already network-first (serves cache only in the offline `catch`) and always replaces the cached copy on a successful fetch. It is not a source of online staleness.
