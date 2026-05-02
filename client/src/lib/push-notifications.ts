import { apiRequest } from "./queryClient";

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

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.register("/sw.js");
    return registration;
  } catch (e) {
    console.error("SW registration failed:", e);
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

// In-flight lock so concurrent callers (e.g. AuthenticatedLayout's silent
// sync running at the same time the user clicks "Enable" in Settings) share
// one underlying pushManager.subscribe call instead of racing it.
let subscribeInFlight: Promise<boolean> | null = null;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function doSubscribe(promptPermission: boolean): Promise<boolean> {
  try {
    if (promptPermission) {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        console.warn("Notification permission not granted");
        return false;
      }
    } else if (Notification.permission !== "granted") {
      return false;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      const vapidKey = await getVapidKey();
      if (!vapidKey) {
        console.error("No VAPID key available");
        return false;
      }
      subscription = await withTimeout(
        registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }),
        15000,
        "pushManager.subscribe",
      );
      console.log("New push subscription created");
    } else {
      console.log("Existing push subscription found, re-registering with server");
    }

    const subJson = subscription.toJSON();
    if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) return false;
    await withTimeout(
      apiRequest("POST", "/api/push/subscribe", {
        endpoint: subJson.endpoint,
        keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
      }),
      10000,
      "POST /api/push/subscribe",
    );
    return true;
  } catch (e) {
    console.error("Push subscription failed:", e);
    return false;
  }
}

export async function subscribeToPush(): Promise<boolean> {
  if (subscribeInFlight) return subscribeInFlight;
  subscribeInFlight = doSubscribe(true).finally(() => { subscribeInFlight = null; });
  return subscribeInFlight;
}

export async function unsubscribeFromPush(): Promise<boolean> {
  try {
    const registration = await navigator.serviceWorker.ready;
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
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch {
    return false;
  }
}

const PUSH_RESYNC_KEY = "sh-push-resync-v1";

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

    const registration = await navigator.serviceWorker.ready;

    if (typeof localStorage !== "undefined" && !localStorage.getItem(PUSH_RESYNC_KEY)) {
      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        const oldEndpoint = existing.endpoint;
        try { await existing.unsubscribe(); } catch {}
        try { await apiRequest("POST", "/api/push/unsubscribe", { endpoint: oldEndpoint }); } catch {}
      }
      try { localStorage.setItem(PUSH_RESYNC_KEY, "1"); } catch {}
    }

    // Share the single in-flight subscribe promise with any concurrent caller
    // (e.g. user clicking "Enable" in Settings at the same time).
    if (subscribeInFlight) { await subscribeInFlight; return; }
    subscribeInFlight = doSubscribe(false).finally(() => { subscribeInFlight = null; });
    await subscribeInFlight;
  } catch (e) {
    console.warn("[Push sync] failed:", e);
  }
}
