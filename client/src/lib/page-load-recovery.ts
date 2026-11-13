const RELOAD_INTERVAL_MS = 60_000;

/** Recover an obsolete route bundle without changing the notification's URL.
 * Session storage survives the reload and bounds recovery even if the server
 * is still deploying. Never auto-reload offline or without a working guard.
 */
export function recoverPageImport(deps: {
  storage: Pick<Storage, "getItem" | "setItem">;
  destination: string;
  online: boolean;
  reload: () => void;
  now?: number;
}): boolean {
  if (!deps.online) return false;
  const now = deps.now ?? Date.now();
  const key = `servicehub-page-recovery:${deps.destination}`;
  try {
    const previous = deps.storage.getItem(key);
    if (previous !== null && now - Number(previous) < RELOAD_INTERVAL_MS) return false;
    deps.storage.setItem(key, String(now));
  } catch {
    return false;
  }
  deps.reload();
  return true;
}
