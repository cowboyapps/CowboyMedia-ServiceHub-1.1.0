// Helpers for recovering from a stale-deploy white-screen scenario.
// Extracted so they can be exercised by unit tests without spinning up
// a browser / React renderer.

export interface StaleDeployReloadHandlerDeps {
  reload: () => void;
  clearSplash?: () => void;
}

export interface SWReloadMessage {
  type: string;
  reason?: string;
}

export function createStaleDeployReloadHandler(deps: StaleDeployReloadHandlerDeps) {
  let reloading = false;
  return (event: { data: unknown }) => {
    const data = event.data as SWReloadMessage | null | undefined;
    if (!data || typeof data !== "object") return;
    if (data.type !== "SW_RELOAD_REQUIRED") return;
    if (reloading) return;
    reloading = true;
    try {
      deps.clearSplash?.();
    } catch {
      // ignore — best-effort
    }
    deps.reload();
  };
}

export interface RecoverFromStaleDeployDeps {
  serviceWorker?: {
    getRegistrations: () => Promise<Array<{ unregister: () => Promise<boolean> }>>;
  };
  caches?: {
    keys: () => Promise<string[]>;
    delete: (key: string) => Promise<boolean>;
  };
  reload: () => void;
}

export async function recoverFromStaleDeploy(deps: RecoverFromStaleDeployDeps) {
  try {
    if (deps.serviceWorker) {
      const regs = await deps.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
    }
    if (deps.caches) {
      const keys = await deps.caches.keys();
      await Promise.all(keys.map((k) => deps.caches!.delete(k).catch(() => false)));
    }
  } catch {
    // Best-effort recovery — fall through to reload regardless.
  }
  deps.reload();
}
