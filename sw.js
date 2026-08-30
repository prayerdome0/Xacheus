/**
 * Xacheus — service worker
 * Caches app shell, never caches Firebase or File Storage.
 */

const CACHE_NAME = "xacheus-video-v12";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/data.js",
  "./js/ui.js",
  "./js/brand.js",
  "./js/social.js",
  "./js/music.js",
  "./js/player.js",
  "./js/pwa.js",
  "./js/auth.js",
  "./js/storage.js",
  "./js/views/components.js",
  "./js/views/home.js",
  "./js/views/discover.js",
  "./js/views/create.js",
  "./js/views/sounds.js",
  "./js/views/profile.js",
  "./js/views/notifications.js",
  "./js/views/messages.js",
  "./js/views/live.js",
  "./js/views/settings.js",
  "./js/views/admin.js",
  "./manifest.json",
  "./assets/logo.png", // measured by js/brand.js at runtime
  "./assets/logo-wordmark.png",
  "./assets/logo-wordmark-dark.png",
  "./assets/icon.svg",
  "./assets/icon-dark.svg",
  "./assets/brand-card.png",
  "./assets/brand-manifest.json",
  "./assets/logo-plate.png",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./assets/icon-maskable-192.png",
  "./assets/icon-maskable-512.png",
  "./assets/apple-touch-icon.png",
  "./assets/favicon-32.png",
  "./assets/favicon.ico",
];

const NEVER_CACHE = [
  "firestore.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "www.gstatic.com",
  "firebasestorage.googleapis.com",
];

self.addEventListener("install", (event) => {
  // Individual puts, so one missing shell file can't fail the whole install.
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(
        SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      )
    )
  );
});

// The page asks us to activate immediately when the user accepts an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.registration.navigationPreload?.enable?.())
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || NEVER_CACHE.some((h) => url.hostname.includes(h))) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put("./index.html", copy));
        return res;
      }).catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // Network-first for app code *and* for the brand artwork: a logo that changed
  // shape or colour is exactly the case where serving the previous cached copy
  // would undo the plate decision. Content images (covers, avatars, video
  // posters) stay cache-first, since they are immutable per upload.
  const isCode = /\.(js|css|json)$/.test(url.pathname);
  const isBrandArt = /\/assets\/(logo|icon|apple-touch-icon|favicon|brand-card)[\w.-]*$/.test(url.pathname);

  if (isCode || isBrandArt) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
