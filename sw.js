/**
 * Xacheus — service worker (Phase 1: video platform)
 * Caches app shell, never caches Firebase or Cloudinary.
 */

const CACHE_NAME = "xacheus-video-v3";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/data.js",
  "./js/ui.js",
  "./js/auth.js",
  "./js/cloudinary.js",
  "./js/views/components.js",
  "./js/views/home.js",
  "./js/views/discover.js",
  "./js/views/create.js",
  "./js/views/sounds.js",
  "./js/views/profile.js",
  "./js/views/notifications.js",
  "./js/views/settings.js",
  "./js/views/admin.js",
  "./assets/icon.svg",
];

const NEVER_CACHE = [
  "firestore.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "www.gstatic.com",
  "api.cloudinary.com",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))).then(() => self.clients.claim())
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

  // Network-first for app code so a stale cached bundle can never pin users to
  // an old (broken) build; cache-first for everything else (icons, images).
  const isCode = /\.(js|css|json)$/.test(url.pathname);

  if (isCode) {
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
