// Shared teardown for jsdom React component tests.
//
// Why this exists: these tests mount real client components against a TanStack
// Query client and tear down with `queryClient.clear()`. That is enough for a
// read-only page, but the moment a test fires a `useMutation` (e.g. a POST) and
// then unmounts, React Query schedules a *mutation* garbage-collection timer
// (default gcTime = 5 minutes). `queryClient.clear()` does NOT cancel it —
// `MutationCache.remove()` never calls `mutation.destroy()` — so that ref'd
// timer keeps the node:test event loop alive long past the assertions. The file
// then hangs until `script/run-tests.ts`'s per-file watchdog SIGKILLs it, which
// surfaces as a confusing "timeout/crash" that looks like an OOM.
//
// `setupComponentTestTeardown` standardises the safe teardown so new component
// tests opt in with one line instead of rediscovering the trap:
//   - collapse `queries`/`mutations` gcTime to 0 on whichever client the test
//     drives (singleton or throwaway), so the gc timer fires immediately
//   - on `after`, clear the client and close the jsdom window
//   - assert no long-lived, still-ref'd timer survived teardown, so a future
//     regression fails with a clear message instead of a watchdog kill.
//
// CAVEAT: collapsing queries gcTime to 0 means any cache entry with no active
// observer is garbage-collected immediately. A test that seeds the cache via
// setQueryData and reads it back WITHOUT a mounted observer (e.g. a focus-refresh
// path) must NOT use this helper for that data, or pass
// `collapseQueryGcTime: false` and tear queries down itself.

import { after } from "node:test";
import assert from "node:assert/strict";
import type { QueryClient } from "@tanstack/react-query";

// React Query's default gcTime is 5 min; anything at/above this threshold that
// is still ref'd after teardown would pin the event loop. Kept well above the
// 0-delay timers these tests legitimately schedule (rAF shims, sleep(0)).
const DEFAULT_LONG_TIMER_MS = 30_000;

interface TrackedTimer {
  delayMs: number;
  handle: unknown;
  cleared: boolean;
  fired: boolean;
}

// A Node timer handle exposes hasRef()/unref(); a browser numeric handle does
// not. Only ref'd handles keep the loop alive, so an unref'd long timer (e.g.
// the toast-removal timer, which unref()s itself) is intentionally NOT flagged.
interface RefTimerHandle {
  hasRef?: () => boolean;
}

export interface LongTimerGuard {
  /**
   * Returns one human-readable line per long-lived timer that is still pending
   * (not fired), was never cleared, and remains ref'd. An empty array means the
   * teardown is clean.
   */
  check(): string[];
  /** Restore the original global timer functions. */
  uninstall(): void;
}

type TimeoutFn = (handler: unknown, timeout?: number, ...args: unknown[]) => unknown;

/**
 * Wrap global setTimeout/clearTimeout to track long-lived timers. Exported so it
 * can be unit-tested directly; most tests just call setupComponentTestTeardown.
 */
export function installLongTimerGuard(
  thresholdMs: number = DEFAULT_LONG_TIMER_MS,
): LongTimerGuard {
  const tracked: TrackedTimer[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const rawSet = realSetTimeout as unknown as TimeoutFn;
  const rawClear = realClearTimeout as unknown as (handle?: unknown) => void;

  const wrappedSetTimeout = ((handler: unknown, timeout?: number, ...args: unknown[]) => {
    const delayMs = typeof timeout === "number" ? timeout : 0;
    if (delayMs >= thresholdMs && typeof handler === "function") {
      const rec: TrackedTimer = { delayMs, handle: undefined, cleared: false, fired: false };
      const cb = handler as (...a: unknown[]) => void;
      const wrapped = (...a: unknown[]) => {
        rec.fired = true;
        cb(...a);
      };
      const handle = rawSet(wrapped, timeout, ...args);
      rec.handle = handle;
      tracked.push(rec);
      return handle;
    }
    return rawSet(handler, timeout, ...args);
  }) as unknown as typeof globalThis.setTimeout;
  Object.assign(wrappedSetTimeout, realSetTimeout);

  const wrappedClearTimeout = ((handle?: unknown) => {
    for (const rec of tracked) {
      if (rec.handle === handle) rec.cleared = true;
    }
    return rawClear(handle);
  }) as unknown as typeof globalThis.clearTimeout;
  Object.assign(wrappedClearTimeout, realClearTimeout);

  globalThis.setTimeout = wrappedSetTimeout;
  globalThis.clearTimeout = wrappedClearTimeout;

  return {
    check() {
      const offenders: string[] = [];
      for (const rec of tracked) {
        if (rec.cleared || rec.fired) continue;
        const h = rec.handle as RefTimerHandle | null;
        const stillRef = h && typeof h.hasRef === "function" ? h.hasRef() : true;
        if (stillRef) {
          offenders.push(
            `a ${Math.round(rec.delayMs / 1000)}s timer is still pending and ref'd`,
          );
        }
      }
      return offenders;
    },
    uninstall() {
      globalThis.setTimeout = realSetTimeout;
      globalThis.clearTimeout = realClearTimeout;
    },
  };
}

export interface ComponentTeardownOptions {
  /** The QueryClient the test mounts its components against. */
  queryClient: QueryClient;
  /** The jsdom window to close on teardown (optional). */
  window?: { close: () => void };
  /**
   * Collapse queries gcTime to 0 (default true). Set false for tests that seed
   * the cache and read it back without an active observer (gcTime:0 would GC the
   * seeded entry immediately). mutations gcTime is always collapsed.
   */
  collapseQueryGcTime?: boolean;
  /** Guard against long-lived ref'd timers surviving teardown (default true). */
  guardLongTimers?: boolean;
  /** Override the long-timer threshold in ms (default 30000). */
  longTimerThresholdMs?: number;
}

/**
 * One-line safe teardown for a jsdom component test. Call once at module scope,
 * right after the QueryClient is imported/created:
 *
 *   setupComponentTestTeardown({ queryClient, window });
 *
 * It collapses gcTime to 0 on the given client, registers an `after` hook that
 * clears the client and closes the window, and (by default) asserts no
 * long-lived ref'd timer survived — turning a silent watchdog hang into a loud,
 * actionable test failure. Returns the installed guard (or null) for tests that
 * want to inspect it.
 */
export function setupComponentTestTeardown(
  opts: ComponentTeardownOptions,
): LongTimerGuard | null {
  const {
    queryClient,
    window,
    collapseQueryGcTime = true,
    guardLongTimers = true,
    longTimerThresholdMs,
  } = opts;

  const defaults = queryClient.getDefaultOptions();
  queryClient.setDefaultOptions({
    ...defaults,
    queries: collapseQueryGcTime
      ? { ...defaults.queries, gcTime: 0 }
      : defaults.queries,
    mutations: { ...defaults.mutations, gcTime: 0 },
  });

  const guard = guardLongTimers ? installLongTimerGuard(longTimerThresholdMs) : null;

  after(() => {
    try {
      queryClient.clear();
      window?.close();
    } catch {
      // best-effort: never let teardown noise mask the real assertion below
    }
    if (guard) {
      const offenders = guard.check();
      guard.uninstall();
      assert.equal(
        offenders.length,
        0,
        `Component test left ${offenders.length} long-lived timer(s) that would ` +
          `hang the file until the watchdog SIGKILLs it:\n` +
          offenders.map((o) => `  - ${o}`).join("\n") +
          `\nEnsure every QueryClient the test drives goes through ` +
          `setupComponentTestTeardown (it sets gcTime:0), or unref/clear any ` +
          `long-lived timer you schedule.`,
      );
    }
  });

  return guard;
}
