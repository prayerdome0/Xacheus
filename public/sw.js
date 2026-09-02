/* Seedwel Hub service worker
 * Strategy:
 *   - App shell + brand assets: cache-first with background refresh (stale-while-revalidate)
 *   - Firebase API/auth: network-only. Never cache business data — it is live and private.
 *   - Offline: serve the cached shell so the app opens and shows a clear offline state.
 */
const VERSION = 'seedwel-hub-v1';
const SHELL = [
  '/',
  '/manifest.json',
  '/brand/icon.svg',
  '/brand/reallogo.png',
  '/brand/wordmarklogo.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL).catch(() => undefined))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isApiRequest = (url) =>
  url.pathname.startsWith('/rest/v1/') ||
  url.pathname.startsWith('/auth/v1/') ||
  url.pathname.startsWith('/storage/v1/') ||
  url.pathname.startsWith('/rpc/');

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !url.pathname.startsWith('/brand')) {
    if (isApiRequest(url)) return; // never cache API traffic
  }
  if (isApiRequest(url)) return;

  // Static assets & navigation: stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && (response.status === 200 || response.type === 'opaque')) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy)).catch(() => undefined);
          }
          return response;
        })
        .catch(() => cached || caches.match('/'));
      return cached || network;
    }),
  );
});

// Let the app trigger a skipWaiting after a new version is installed.
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

/* ── Web Push (Phase 6) ──────────────────────────────────────────────────────
 * The app subscribes this browser to Web Push (VAPID) and stores the token in
 * `push_tokens`. A server / Cloud Function sends message data with
 * `title`, `body`, `url` and `tag`. When the tab is closed the browser wakes
 * this worker and we show a notification; when it is open the app's
 * <PushForegroundListener/> receives the message via the FCM SDK instead.
 */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'Seedwel Hub';
  const options = {
    body: data.body || '',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    tag: data.tag || `seedwel-${Date.now()}`,
    data: { url: data.url || '/' },
    actions: [{ action: 'open', title: 'Open Seedwel Hub' }],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
