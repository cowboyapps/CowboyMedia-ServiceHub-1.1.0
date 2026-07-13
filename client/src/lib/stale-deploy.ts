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
    getRegistrations: () => Promise<ReadonlyArray<{ scope?: string; unregister: () => Promise<boolean> }>>;
  };
  caches?: {
    keys: () => Promise<string[]>;
    delete: (key: string) => Promise<boolean>;
  };
  reload: () => void;
  // True when running inside the admin PWA (/admin). The customer app and the
  // admin app each hold their own service-worker registration + caches, so
  // recovery must only tear down its OWN app's state — nuking the other app's
  // registration would silently break its offline shell and push subscription.
  adminApp?: boolean;
}

function ownsRegistration(scope: string | undefined, adminApp: boolean): boolean {
  if (!scope) return true; // can't tell — keep legacy behavior for this entry
  let pathname: string;
  try {
    pathname = new URL(scope, "http://x").pathname;
  } catch {
    return true;
  }
  const isAdminScope = pathname === "/admin" || pathname.startsWith("/admin/");
  return adminApp ? isAdminScope : !isAdminScope;
}

function ownsCache(key: string, adminApp: boolean): boolean {
  const isAdminCache = key.startsWith("servicehub-admin-");
  return adminApp ? isAdminCache : !isAdminCache;
}

export async function recoverFromStaleDeploy(deps: RecoverFromStaleDeployDeps) {
  const adminApp = !!deps.adminApp;
  try {
    if (deps.serviceWorker) {
      const regs = await deps.serviceWorker.getRegistrations();
      await Promise.all(
        regs
          .filter((r) => ownsRegistration(r.scope, adminApp))
          .map((r) => r.unregister().catch(() => false)),
      );
    }
    if (deps.caches) {
      const keys = await deps.caches.keys();
      await Promise.all(
        keys
          .filter((k) => ownsCache(k, adminApp))
          .map((k) => deps.caches!.delete(k).catch(() => false)),
      );
    }
  } catch {
    // Best-effort recovery — fall through to reload regardless.
  }
  deps.reload();
}
