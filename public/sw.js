/* Seedwel Hub service worker
 * Strategy:
 *   - App shell + brand assets: cache-first with background refresh (stale-while-revalidate)
 *   - Supabase API/auth: network-only. Never cache business data — it is live and private.
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
  url.hostname.endsWith('.supabase.co') ||
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
