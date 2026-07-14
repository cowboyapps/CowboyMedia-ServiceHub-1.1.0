import { useEffect, useState } from "react";

// Tiny global modal coordinator. Each popup that wants to be visible
// "claims a slot" with an id + priority + want. At any moment, only the
// highest-priority claim with want=true is the active slot — everyone else
// stays hidden. When the active slot releases (user dismisses → want flips
// to false), the next highest one automatically becomes active.
//
// This is what prevents the new-customer flood where the onboarding tour,
// admin announcement and version-welcome dialog all popped at once and
// locked up the device.

const requests = new Map<string, number>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

function topSlotId(): string | null {
  let bestId: string | null = null;
  let bestPriority = -Infinity;
  for (const [id, priority] of requests) {
    if (priority > bestPriority) {
      bestPriority = priority;
      bestId = id;
    }
  }
  return bestId;
}

export function useModalSlot(id: string, priority: number, want: boolean): boolean {
  const [, force] = useState(0);

  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    if (want) {
      requests.set(id, priority);
    } else {
      requests.delete(id);
    }
    notify();
    return () => {
      if (requests.delete(id)) notify();
    };
  }, [id, priority, want]);

  return want && topSlotId() === id;
}

// True while ANY popup currently claims a slot (i.e. an overlay is or is
// about to be on screen). Lets non-modal UI (e.g. the deep-link row pulse)
// hold off until the user can actually see the page.
export function useModalQueueBusy(): boolean {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  return requests.size > 0;
}

// Test/debug helpers — not used in production code.
export function _resetModalQueueForTests(): void {
  requests.clear();
  listeners.clear();
}
