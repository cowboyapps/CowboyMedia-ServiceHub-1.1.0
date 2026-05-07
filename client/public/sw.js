const CACHE_VERSION = 'v12';
const SHELL_CACHE = `servicehub-shell-${CACHE_VERSION}`;
const ASSETS_CACHE = `servicehub-assets-${CACHE_VERSION}`;
const API_CACHE = `servicehub-api-${CACHE_VERSION}`;
const STATIC_PRECACHE = [
  '/',
  '/manifest.json',
  '/splash.mp4',
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

async function handleApi(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const clone = response.clone();
      caches.open(API_CACHE).then((cache) => cache.put(request, clone)).catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
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

self.addEventListener('push', (event) => {
  let data = { title: 'ServiceHub', body: 'You have a new notification', url: '/' };
  try {
    data = event.data.json();
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body: data.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/' },
    actions: data.actions || [],
    tag: data.tag || 'default',
    renotify: true,
  };

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const isAdminChat = data.tag && data.tag.startsWith('admin-chat-');
      if (isAdminChat) {
        const viewingAdmin = clients.some((client) =>
          client.visibilityState === 'visible' && client.url && client.url.includes('/admin')
        );
        if (viewingAdmin) {
          return;
        }
      }
      return self.registration.showNotification(data.title, options).then(() => {
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.registration.getNotifications().then((notifications) => {
      const remaining = notifications.length;
      if (self.navigator && self.navigator.setAppBadge) {
        if (remaining > 0) {
          self.navigator.setAppBadge(remaining).catch(() => {});
        } else {
          self.navigator.clearAppBadge().catch(() => {});
        }
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
