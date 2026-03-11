const CACHE_NAME = 'servicehub-v7';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/splash.mp4',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== CACHE_NAME + '-api').map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  
  const url = event.request.url;
  if (url.includes('/ws')) return;

  if (url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === 'GET') {
            const clone = response.clone();
            caches.open(CACHE_NAME + '-api').then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => {
          if (event.request.method === 'GET') {
            return caches.match(event.request).then((cached) => {
              if (cached) return cached;
              return new Response(JSON.stringify({ error: 'offline' }), {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              });
            });
          }
          return new Response(JSON.stringify({ error: 'offline', message: 'You are offline. Please try again when connected.' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        })
    );
    return;
  }
  
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200 && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
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
        if (self.navigator && self.navigator.setAppBadge) {
          self.navigator.setAppBadge().catch(() => {});
        }
      });
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
