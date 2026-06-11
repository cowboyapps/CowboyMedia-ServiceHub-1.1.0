import { useCallback, useEffect, useState } from "react";
import { type SeenMap, markSeen } from "@shared/whmcs-unread";

// Client-side persistence + reactivity for the "new billing-ticket reply"
// indicator. The pure comparison logic lives in @shared/whmcs-unread; this file
// only deals with localStorage (per-user, so a shared device doesn't leak one
// customer's read state to another) and broadcasting changes within the tab.

const KEY_PREFIX = "whmcs-ticket-seen:";
const CHANGED_EVENT = "whmcs-ticket-seen-changed";

function storageKey(userId: string | null | undefined): string {
  return `${KEY_PREFIX}${userId ?? "anon"}`;
}

export function readSeenMap(userId: string | null | undefined): SeenMap {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as SeenMap) : {};
  } catch {
    return {};
  }
}

function writeSeenMap(userId: string | null | undefined, map: SeenMap): void {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(map));
  } catch {
    /* ignore quota / private-mode failures — the badge just won't persist */
  }
  // Notify in-tab listeners even if persistence failed, so the UI stays in sync.
  window.dispatchEvent(new CustomEvent(CHANGED_EVENT));
}

/** Record that the customer has now read a ticket's thread up to latestDate. */
export function markTicketSeen(
  userId: string | null | undefined,
  ticketId: number,
  latestDate: string | null,
): void {
  const current = readSeenMap(userId);
  const next = markSeen(current, ticketId, latestDate);
  if (next !== current) writeSeenMap(userId, next);
}

/**
 * Reactive read of the per-user seen map. Re-reads on mount and whenever a
 * thread marks a ticket seen in this tab, or another tab updates localStorage.
 */
export function useWhmcsSeenMap(userId: string | null | undefined): SeenMap {
  const [seen, setSeen] = useState<SeenMap>(() => readSeenMap(userId));
  const refresh = useCallback(() => setSeen(readSeenMap(userId)), [userId]);
  useEffect(() => {
    refresh();
    window.addEventListener(CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [refresh]);
  return seen;
}
