/**
 * Xacheus Social — service worker.
 *
 * Caches the app shell for instant loads. Everything Firebase (auth, Firestore,
 * gstatic SDK) and all uploads are always fetched from the network so real-time
 * data is never served stale.
 */

const CACHE_NAME = "xacheus-social-v1";
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
  "./js/views/explore.js",
  "./js/views/notifications.js",
  "./js/views/messages.js",
  "./js/views/profile.js",
  "./js/views/thread.js",
  "./js/views/settings.js",
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
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== location.origin || NEVER_CACHE.some((host) => url.hostname.includes(host))) {
    return; // let the browser handle it normally
  }

  // Navigations: network first so a fresh deploy is picked up, offline falls back to cache.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          return response;
        })
        .catch(() => caches.match("./index.html").then((hit) => hit || caches.match("./")))
    );
    return;
  }

  // Static assets: cache first, update in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
