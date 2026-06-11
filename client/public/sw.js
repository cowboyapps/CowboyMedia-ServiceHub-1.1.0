// __BUILD_ID__ is replaced at build time by script/build.ts with a unique
// per-deploy id so the cache version automatically rotates on every deploy.
// In dev (no replacement), it falls back to a stable string.
const CACHE_VERSION = '__BUILD_ID__'.startsWith('__') ? 'dev' : '__BUILD_ID__';
const SHELL_CACHE = `servicehub-shell-${CACHE_VERSION}`;
const ASSETS_CACHE = `servicehub-assets-${CACHE_VERSION}`;
const API_CACHE = `servicehub-api-${CACHE_VERSION}`;
const STATIC_PRECACHE = [
  '/',
  '/manifest.json',
  '/favicon.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

const NAV_TIMEOUT_MS = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      Promise.all(
        STATIC_PRECACHE.map((url) =>
          cache.add(url).catch(() => {})
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const allowed = new Set([SHELL_CACHE, ASSETS_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !allowed.has(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

function isHashedAsset(url) {
  if (!url.pathname.startsWith('/assets/')) return false;
  return /-[A-Za-z0-9_-]{6,}\.(?:js|css|woff2?|ttf|otf|png|jpg|jpeg|gif|svg|webp|ico|mp4|webm)(?:\?.*)?$/.test(url.pathname);
}

function isNavigationRequest(request) {
  if (request.mode === 'navigate') return true;
  if (request.method !== 'GET') return false;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/html');
}

async function notifyClientsToReload(reason) {
  try {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      client.postMessage({ type: 'SW_RELOAD_REQUIRED', reason });
    }
  } catch {}
}

async function handleNavigation(request) {
  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('nav-timeout')), NAV_TIMEOUT_MS)
      ),
    ]);
    if (fresh && fresh.ok) {
      const clone = fresh.clone();
      caches.open(SHELL_CACHE).then((cache) => cache.put('/', clone)).catch(() => {});
      return fresh;
    }
    if (fresh) return fresh;
  } catch {
    // network failed or timed out — fall through to cached shell
  }
  const cached = (await caches.match(request)) || (await caches.match('/'));
  if (cached) return cached;
  return new Response(
    '<!doctype html><meta charset="utf-8"><title>Offline</title><body style="font-family:system-ui;padding:2rem;text-align:center"><h1>Offline</h1><p>Please reconnect and try again.</p></body>',
    { status: 503, headers: { 'Content-Type': 'text/html' } }
  );
}

async function handleHashedAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(ASSETS_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
      return response;
    }
    if (response.status === 404) {
      // Hashed asset missing → deploy mismatch. Tell clients to reload to pick up the new shell.
      notifyClientsToReload('asset-404');
    }
    return response;
  } catch {
    notifyClientsToReload('asset-network-error');
    return new Response('', { status: 504, statusText: 'Asset unavailable' });
  }
}

function isUncacheableApi(url) {
  // Admin endpoints, auth/session, and anything that mutates frequently must
  // always go to the network — caching them caused a real bug where the
  // admin Changelog tab kept rendering an empty draft long after appends had
  // landed in the DB (cached SW response masked the fresh server data).
  if (url.pathname.startsWith('/api/admin/')) return true;
  if (url.pathname.startsWith('/api/auth/')) return true;
  if (url.pathname === '/api/user') return true;
  return false;
}

async function handleApi(request) {
  let url;
  try { url = new URL(request.url); } catch { url = null; }
  const skipCache = url ? isUncacheableApi(url) : false;
  try {
    const response = await fetch(request);
    if (response.ok && !skipCache) {
      const clone = response.clone();
      caches.open(API_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
    }
    return response;
  } catch {
    if (!skipCache) {
      const cached = await caches.match(request);
      if (cached) return cached;
    }
    return new Response(JSON.stringify({ error: 'offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleOther(request) {
  try {
    const response = await fetch(request);
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.pathname.includes('/ws')) return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(handleApi(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(handleHashedAsset(request));
    return;
  }

  event.respondWith(handleOther(request));
});

// Build a calm, rolled-up toast title/body for the Nth push on the same
// resource-level `tag`. Pure helper kept on `self` so test/sw.test.ts
// can exercise it directly.
//
// `prevCount` is the running unread count carried in the previous toast's
// data.rollupCount (or 0 if no prior toast exists). The new toast represents
// `prevCount + 1` unread events. We only roll up once the running total
// reaches 2 — the first push always shows its original body verbatim.
//
// Counting cannot rely on `getNotifications({tag}).length` alone because
// same-tag pushes *replace* the previous toast, so that length never
// exceeds 1 — we'd be stuck at "2 new …" forever. Persisting the count
// in the notification's data unlocks 3, 4, 5… as expected.
self.buildRollup = function buildRollup(data, prevCount) {
  const total = (prevCount || 0) + 1;
  if (total < 2) {
    return { title: data.title, body: data.body, total: total };
  }
  const noun = data.rollupNoun || 'updates';
  const label = data.resourceLabel || data.title || 'this conversation';
  return {
    title: data.title,
    body: total + ' new ' + noun + ' on ' + label,
    total: total,
  };
};

self.addEventListener('push', (event) => {
  let data = { title: 'ServiceHub', body: 'You have a new notification', url: '/' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const tag = data.tag || 'default';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const isAdminChat = tag && tag.startsWith('admin-chat-');
      if (isAdminChat) {
        const viewingAdmin = clients.some((client) =>
          client.visibilityState === 'visible' && client.url && client.url.includes('/admin')
        );
        if (viewingAdmin) {
          return;
        }
      }
      // Count existing unread toasts for this same resource-level tag so
      // we can collapse N back-to-back pushes into a single rolled-up
      // toast ("3 new replies on Ticket …") instead of stacking N rows
      // in the OS tray.
      return self.registration.getNotifications({ tag }).then((sameTag) => {
        // Read the running rollup count from the previous toast for this
        // tag (if any). Same-tag pushes replace each other, so this is
        // how the count crosses 2 → 3 → 4 — the count lives in
        // `data.rollupCount` on the previous toast, not in the toast
        // tray length.
        const prevCount = sameTag.length > 0
          ? ((sameTag[0].data && sameTag[0].data.rollupCount) || 1)
          : 0;
        const rolled = self.buildRollup(data, prevCount);
        const options = {
          body: rolled.body,
          icon: '/icons/icon-192.png',
          badge: '/icons/badge-96.png',
          vibrate: [200, 100, 200],
          data: {
            url: data.url || '/',
            notificationId: data.notificationId || null,
            tag,
            rollupCount: rolled.total,
          },
          actions: data.actions || [],
          tag,
          renotify: true,
        };
        return self.registration.showNotification(rolled.title, options);
      }).then(() => {
        return self.registration.getNotifications().then((notifications) => {
          const count = notifications.length;
          if (self.navigator && self.navigator.setAppBadge) {
            self.navigator.setAppBadge(count).catch(() => {});
          }
        }).catch(() => {
          if (self.navigator && self.navigator.setAppBadge) {
            self.navigator.setAppBadge(1).catch(() => {});
          }
        });
      });
    })
  );
});

function refreshAppBadge() {
  return self.registration.getNotifications().then((notifications) => {
    const remaining = notifications.length;
    if (self.navigator && self.navigator.setAppBadge) {
      if (remaining > 0) {
        self.navigator.setAppBadge(remaining).catch(() => {});
      } else {
        self.navigator.clearAppBadge().catch(() => {});
      }
    }
  });
}

self.addEventListener('notificationclick', (event) => {
  const data = event.notification.data || {};
  const notificationId = data.notificationId;

  // "Mark as read" action: silently mark the row read on the server,
  // close the notification, and refresh the OS app badge — without
  // opening or focusing the app. Falls back to default-click behavior
  // if the id is missing for any reason.
  if (event.action === 'mark-read' && notificationId) {
    event.notification.close();
    const tag = data.tag || event.notification.tag;
    event.waitUntil(
      fetch('/api/notifications/' + encodeURIComponent(notificationId) + '/read', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      })
        .catch(() => {})
        // Close every other rolled-up toast for the same resource so the
        // user sees the whole group disappear at once. The PATCH above
        // already marks all peer notification rows read on the server.
        .then(() => {
          if (!tag) return;
          return self.registration.getNotifications({ tag }).then((peers) => {
            for (const n of peers) {
              try { n.close(); } catch {}
            }
          }).catch(() => {});
        })
        .then(() => refreshAppBadge())
    );
    return;
  }

  event.notification.close();
  const url = data.url || '/';
  // Absolute, cross-origin targets (e.g. a WHMCS invoice pay page) must open in
  // their own window — navigating an already-open same-origin ServiceHub tab to
  // an external URL would hijack the PWA away from itself.
  let isExternal = false;
  try {
    isExternal = new URL(url, self.location.origin).origin !== self.location.origin;
  } catch (e) {
    isExternal = false;
  }
  event.waitUntil(
    refreshAppBadge().then(() => {
      if (isExternal) {
        return self.clients.openWindow(url);
      }
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      });
    })
  );
});
