import { apiRequest } from "./queryClient";

export type PushResult = { ok: true } | { ok: false; code: string; reason: string };

// Which service-worker scope this bundle manages. The customer app (main.tsx)
// leaves it unset → default scope "/". The admin PWA entry (admin-main.tsx)
// calls configurePushScope("/admin") before anything registers, so BOTH apps
// share the same /sw.js script but hold two independent registrations —
// separate caches, separate push subscriptions, separate lifecycles. All
// helpers below (register, self-heal, resync gate) operate strictly on their
// own scope so neither app can clobber the other's registration.
let swScope: string | null = null;

export function configurePushScope(scope: string): void {
  swScope = scope;
}

function scopePathname(): string {
  return swScope || "/";
}

function isOwnRegistration(reg: ServiceWorkerRegistration): boolean {
  try {
    const p = new URL(reg.scope).pathname;
    const own = scopePathname();
    return p === own || p === `${own}/`;
  } catch {
    return true;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function isPushSupported(): Promise<boolean> {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  return Notification.permission;
}

// Clear, platform-specific guidance for when notifications are blocked at the
// browser/device level. A blocked permission can't be re-prompted — the user
// has to flip it back on manually — so a generic "try again" is useless here.
// We tailor the steps to where the toggle actually lives on each platform.
export function blockedNotificationsHelp(): string {
  if (isIOS()) {
    return "Notifications are blocked. Open your device Settings, find ServiceHub (under Notifications), turn Allow Notifications on, then come back and try again.";
  }
  if (isAndroid()) {
    return "Notifications are blocked. Tap the lock icon next to the address bar (or your browser's Site settings), set Notifications to Allow, then reload and try again.";
  }
  return "Notifications are blocked for this site. Click the lock or site-info icon in your browser's address bar, set Notifications to Allow, then reload the page and try again.";
}

function isIOS(): boolean {
  try {
    return (
      /iP(hone|ad|od)/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && (navigator.maxTouchPoints || 0) > 1)
    );
  } catch {
    return false;
  }
}

function isAndroid(): boolean {
  try {
    return /Android/i.test(navigator.userAgent);
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  try {
    return (
      (typeof window !== "undefined" &&
        typeof window.matchMedia === "function" &&
        window.matchMedia("(display-mode: standalone)").matches) ||
      (navigator as unknown as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

function errName(e: unknown): string {
  if (e && typeof e === "object" && "name" in e && (e as { name?: unknown }).name) {
    return String((e as { name?: unknown }).name);
  }
  return "error";
}

function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  try {
    return String(e);
  } catch {
    return "unknown error";
  }
}

// Fire-and-forget: record the precise failure stage on the server so it shows up
// in Admin Portal → error logs. iOS PWA users can't open a JS console, so this is
// the only way to see why a subscription attempt failed on a real device.
function reportPushDiagnostic(stage: string, detail: string): void {
  try {
    void apiRequest("POST", "/api/push/diagnostic", {
      stage,
      detail: (detail || "").slice(0, 500),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      standalone: isStandalone(),
      permission: typeof Notification !== "undefined" ? Notification.permission : "unknown",
    }).catch(() => {});
  } catch {
    /* never let diagnostics throw into the caller */
  }
}

// Captured reason of the most recent registerServiceWorker() failure. iOS
// swallows the SW register() rejection (we return null), so we stash the reason
// here to surface it in the failure snapshot — register() throwing is the
// difference between "worker stuck activating" and "worker can't exist at all"
// (e.g. SecurityError when Safari has site data / cookies blocked).
let lastSwRegisterError = "";

// Captured result of probing /sw.js over the network at failure time. Kept as a
// belt-and-braces check: a redirect on the worker script (VPN / iCloud Private
// Relay / content-filter / configuration profile) would surface as type
// "opaqueredirect" under {redirect:"manual"}. On this app the probe came back
// "200/basic" (no redirect) while register() still threw the SecurityError —
// which is what pinned the cause on the explicit scope option, not the network.
let lastSwFetchProbe = "";

async function probeSwScript(): Promise<string> {
  try {
    const res = await fetch("/sw.js", { redirect: "manual", cache: "no-store" });
    if (res.type === "opaqueredirect") return "redirected";
    return `${res.status}/${res.type}${res.redirected ? "+redir" : ""}`;
  } catch (e) {
    return `err:${describeError(e)}`;
  }
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) {
    lastSwRegisterError = "no serviceWorker in navigator";
    return null;
  }
  // The customer app registers with NO explicit scope: the script lives at the
  // site root, so its default scope is already "/" — exactly the coverage we
  // want, and no Service-Worker-Allowed header is even required. The admin PWA
  // registers the SAME script with the NARROWER scope "/admin" — narrowing
  // below the default max scope is always allowed, so no header is needed
  // there either. (Note: the iOS failure that produced "SecurityError: Scope
  // URL should start with the given script URL" was NOT caused by this call —
  // it was a DUPLICATED Service-Worker-Allowed header on the /sw.js response,
  // set by both nginx and Express in production; see server/index.ts and
  // .agents/memory/ios-pwa-push-diagnostics.md.)
  const registerOpts = swScope ? { scope: swScope } : undefined;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js", registerOpts);
    lastSwRegisterError = "";
    lastSwFetchProbe = "";
    return registration;
  } catch (e) {
    lastSwRegisterError = describeError(e);
    lastSwFetchProbe = await probeSwScript();
    console.error("SW registration failed:", e, "| /sw.js probe:", lastSwFetchProbe);
    // Self-heal: a stale/corrupt registration from a previous install can also
    // reject register() (its recorded script URL no longer lines up). Tear down
    // any existing registrations FOR THIS APP'S SCOPE ONLY (the other app's
    // registration must survive) and retry once from a clean slate.
    try {
      const regs = (await navigator.serviceWorker.getRegistrations()).filter(isOwnRegistration);
      if (regs.length > 0) {
        await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
        const retry = await navigator.serviceWorker.register("/sw.js", registerOpts);
        lastSwRegisterError = "";
        return retry;
      }
    } catch (e2) {
      lastSwRegisterError = `${describeError(e)} | retry: ${describeError(e2)}`;
      console.error("SW registration retry failed:", e2);
    }
    return null;
  }
}

async function getVapidKey(): Promise<string | null> {
  const envKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (envKey) return envKey;
  try {
    const res = await fetch("/api/push/vapid-key");
    if (res.ok) {
      const data = await res.json();
      return data.publicKey || null;
    }
  } catch {}
  return null;
}

// True when `subscription` was created for the same VAPID key we're about to use.
// A mismatch means the subscription is stale (server can't deliver to it, and iOS
// throws InvalidStateError if we resubscribe with a different key while it still
// exists). When we can't tell, assume it matches so we never needlessly churn it.
function subscriptionMatchesKey(subscription: PushSubscription, vapidBytes: Uint8Array): boolean {
  try {
    const cur = subscription.options?.applicationServerKey;
    if (!cur) return true;
    const a = new Uint8Array(cur as ArrayBuffer);
    if (a.length !== vapidBytes.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== vapidBytes[i]) return false;
    }
    return true;
  } catch {
    return true;
  }
}

// In-flight lock so concurrent callers (e.g. AuthenticatedLayout's silent
// sync running at the same time the user clicks "Enable" in Settings) share
// one underlying pushManager.subscribe call instead of racing it.
let subscribeInFlight: Promise<PushResult> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// Compact snapshot of the live service-worker state, captured at failure time.
// iOS PWA users can't open a console but CAN screenshot the toast, so we surface
// this (and log it server-side) to pinpoint WHY a worker never activated:
//   reg=ok|null  did register() resolve a registration or throw?
//   got=y|n      did we end up with any registration at all?
//   active/inst/wait  the state of the active / installing / waiting worker
//   ctrl=y|n     is this page currently controlled by a worker?
function swSnapshot(
  registered: ServiceWorkerRegistration | null,
  reg: ServiceWorkerRegistration | null,
): string {
  try {
    const controller =
      "serviceWorker" in navigator ? navigator.serviceWorker.controller : null;
    const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
    const osMatch = ua.match(/OS (\d+)[_.](\d+)/);
    const iosVer = osMatch ? `${osMatch[1]}.${osMatch[2]}` : "?";
    const parts = [
      `ios=${iosVer}`,
      `std=${isStandalone() ? "y" : "n"}`,
      `reg=${registered ? "ok" : "null"}`,
      `got=${reg ? "y" : "n"}`,
      `active=${reg?.active?.state || "-"}`,
      `inst=${reg?.installing?.state || "-"}`,
      `wait=${reg?.waiting?.state || "-"}`,
      `ctrl=${controller ? "y" : "n"}`,
    ];
    if (!registered && lastSwRegisterError) {
      parts.push(`err=${lastSwRegisterError}`);
    }
    if (!registered && lastSwFetchProbe) {
      parts.push(`fetch=${lastSwFetchProbe}`);
    }
    return parts.join(" ");
  } catch {
    return "snapshot-failed";
  }
}

// Resolve a usable service-worker registration WITHOUT depending solely on
// `navigator.serviceWorker.ready`, which is known to hang indefinitely inside
// iOS standalone PWAs even when an active worker already exists. Strategy:
//   1. Use the registration we get back from register()/getRegistration() and
//      return it immediately if it already has an active worker.
//   2. Otherwise wait for whichever signals first: the installing/waiting worker
//      reaching "activated", or the platform `ready` promise — bounded by a
//      timeout so we can never hang.
//   3. As a last resort, if a worker has become active by the deadline, use it
//      anyway rather than failing.
// On failure the thrown error carries a `.swState` snapshot for diagnosis.
async function getActiveRegistration(timeoutMs: number): Promise<ServiceWorkerRegistration> {
  const registered = await registerServiceWorker();
  const fallback = registered ? null : (await navigator.serviceWorker.getRegistration(scopePathname())) || null;
  const reg = registered || (fallback && isOwnRegistration(fallback) ? fallback : null);
  if (reg?.active) return reg;

  // This promise only ever RESOLVES (on activation) — it never rejects. A
  // missing/redundant worker simply defers to serviceWorker.ready (and
  // ultimately the timeout), so a fast rejection can't win the race and rob us
  // of an otherwise-working subscription in an edge timing window.
  const activated = new Promise<ServiceWorkerRegistration>((resolve) => {
    if (!reg) return;
    if (reg.active) { resolve(reg); return; }
    const worker = reg.installing || reg.waiting;
    if (!worker) return;
    const onState = () => {
      if (worker.state === "activated") {
        worker.removeEventListener("statechange", onState);
        resolve(reg);
      } else if (worker.state === "redundant") {
        worker.removeEventListener("statechange", onState);
      }
    };
    worker.addEventListener("statechange", onState);
    onState();
  });

  try {
    // `ready` resolves for whichever registration controls the CURRENT page —
    // on an /admin page that may briefly be the customer app's root-scope
    // worker (before the /admin registration activates). Guard it so a
    // wrong-scope registration can never win the race and mis-scope the push
    // subscription we're about to mint.
    const readyOwn = navigator.serviceWorker.ready.then((r) =>
      isOwnRegistration(r) ? r : activated,
    );
    return await withTimeout(
      Promise.race([activated, readyOwn]),
      timeoutMs,
      "serviceWorker activation",
    );
  } catch (e) {
    const latest = await navigator.serviceWorker.getRegistration(scopePathname());
    if (latest?.active && isOwnRegistration(latest)) return latest;
    const err = new Error(describeError(e)) as Error & { swState?: string };
    err.swState = swSnapshot(registered, latest || reg);
    throw err;
  }
}

async function doSubscribe(): Promise<PushResult> {
  // Permission must already be granted by the time we get here. The prompt is
  // requested by the explicit caller (subscribeToPush) inside the user gesture
  // so iOS actually shows it; the silent sync path only ever runs when
  // permission is already "granted".
  if (Notification.permission !== "granted") {
    return { ok: false, code: "permission", reason: "Notification permission was not granted." };
  }

  // iOS only delivers web push to the app installed on the Home Screen. In a
  // Safari tab PushManager exists but subscribe() fails, so guide the user.
  if (isIOS() && !isStandalone()) {
    reportPushDiagnostic("not-standalone", navigator.userAgent);
    return {
      ok: false,
      code: "not-standalone",
      reason: "Open the app from your Home Screen (not the Safari browser) to turn on notifications.",
    };
  }

  let registration: ServiceWorkerRegistration;
  try {
    registration = await getActiveRegistration(15000);
  } catch (e) {
    const swState = (e as { swState?: string })?.swState || "";
    reportPushDiagnostic("sw-ready", `${describeError(e)} ${swState}`.trim());
    return {
      ok: false,
      code: "sw-ready",
      reason:
        "Your device's background service didn't start in time. Fully close the app and reopen it from your Home Screen, then try again." +
        (swState ? ` (SW: ${swState})` : ""),
    };
  }

  const vapidKey = await getVapidKey();
  if (!vapidKey) {
    reportPushDiagnostic("no-vapid", "vapid key empty");
    return {
      ok: false,
      code: "no-vapid",
      reason: "Notifications aren't configured on the server yet. Please contact support.",
    };
  }
  const vapidBytes = urlBase64ToUint8Array(vapidKey);

  let subscription = await registration.pushManager.getSubscription();

  // Drop a subscription tied to an old VAPID key so we can mint a fresh, usable one.
  if (subscription && !subscriptionMatchesKey(subscription, vapidBytes)) {
    try {
      const old = subscription.endpoint;
      await subscription.unsubscribe();
      try { await apiRequest("POST", "/api/push/unsubscribe", { endpoint: old }); } catch {}
    } catch {}
    subscription = null;
  }

  if (!subscription) {
    try {
      subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: vapidBytes,
        }),
        15000,
        "pushManager.subscribe",
      );
      console.log("New push subscription created");
    } catch (e) {
      reportPushDiagnostic("subscribe", describeError(e));
      return {
        ok: false,
        code: "subscribe",
        reason: `Your device refused the notification subscription (${errName(e)}). Please try again. If it keeps failing, remove the app from your Home Screen and re-add it.`,
      };
    }
  } else {
    console.log("Existing push subscription found, re-registering with server");
  }

  const subJson = subscription.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    reportPushDiagnostic("invalid-sub", "missing endpoint/keys");
    return { ok: false, code: "invalid-sub", reason: "The subscription came back incomplete. Please try again." };
  }

  try {
    await withTimeout(
      apiRequest("POST", "/api/push/subscribe", {
        endpoint: subJson.endpoint,
        keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      }),
      10000,
      "POST /api/push/subscribe",
    );
  } catch (e) {
    reportPushDiagnostic("server-register", describeError(e));
    return {
      ok: false,
      code: "server-register",
      reason: "Couldn't save your subscription on the server. Please check your connection and try again.",
    };
  }

  return { ok: true };
}

export async function subscribeToPush(): Promise<PushResult> {
  // Request permission here — synchronously inside the caller's user gesture —
  // so iOS Safari actually presents the prompt. Doing it here (rather than
  // inside the shared in-flight promise) also guarantees a concurrent silent
  // sync can't hand us back a promise that skipped the prompt.
  try {
    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        const denied = permission === "denied";
        return {
          ok: false,
          code: denied ? "denied" : "dismissed",
          reason: denied
            ? blockedNotificationsHelp()
            : "The permission prompt was dismissed. Tap to try again and choose Allow.",
        };
      }
    }
  } catch (e) {
    reportPushDiagnostic("request-permission", describeError(e));
    return { ok: false, code: "request-permission", reason: "Couldn't request notification permission on this device." };
  }

  if (subscribeInFlight) return subscribeInFlight;
  subscribeInFlight = doSubscribe().finally(() => { subscribeInFlight = null; });
  return subscribeInFlight;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await getActiveRegistration(10000);
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await apiRequest("POST", "/api/push/unsubscribe", { endpoint });
    }
    return true;
  } catch (e) {
    console.error("Push unsubscribe failed:", e);
    return false;
  }
}

export async function isSubscribedToPush(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const registration = await getActiveRegistration(10000);
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

// Scoped per app so the one-time forced resync runs independently for the
// customer app ("/") and the admin PWA ("/admin") — they hold separate
// push subscriptions.
function pushResyncKey(): string {
  return swScope ? `sh-push-resync-v1:${swScope}` : "sh-push-resync-v1";
}

/**
 * Self-healing push subscription sync. Runs silently on app open for users
 * who already granted notification permission. Never prompts.
 *
 * - Forces a one-time unsubscribe + resubscribe (gated by PUSH_RESYNC_KEY) so
 *   customers carrying stale endpoints from a previous deploy get fresh ones.
 * - On every subsequent open, ensures whatever subscription the browser has
 *   is also recorded server-side (the server's createPushSubscription is an
 *   upsert keyed by endpoint, so this is safe to call repeatedly).
 */
export async function syncPushSubscription(): Promise<void> {
  try {
    if (!(await isPushSupported())) return;
    if (Notification.permission !== "granted") return;

    const registration = await getActiveRegistration(10000);

    if (typeof localStorage !== "undefined" && !localStorage.getItem(pushResyncKey())) {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const oldEndpoint = existing.endpoint;
        try { await existing.unsubscribe(); } catch {}
        try { await apiRequest("POST", "/api/push/unsubscribe", { endpoint: oldEndpoint }); } catch {}
      }
      try { localStorage.setItem(pushResyncKey(), "1"); } catch {}
    }

    // Share the single in-flight subscribe promise with any concurrent caller
    // (e.g. user clicking "Enable" in Settings at the same time).
    if (subscribeInFlight) { await subscribeInFlight; return; }
    subscribeInFlight = doSubscribe().finally(() => { subscribeInFlight = null; });
    await subscribeInFlight;
  } catch (e) {
    console.warn("[Push sync] failed:", e);
  }
}
