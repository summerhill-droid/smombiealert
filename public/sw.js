/**
 * SmombieAlert service worker — offline-first PWA cache.
 *
 * Strategy:
 *   - Pre-cache the app shell + Seoul GIS bundled JSON on install.
 *   - Network-first for navigation/HTML (so updates appear when online).
 *   - Cache-first for everything else (JS bundle, fonts, JSON, images).
 *   - Bumping CACHE_VERSION evicts old caches on next activation.
 */

const CACHE_VERSION = "smombie-v1";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Use addAll best-effort: don't fail install if one URL 404s
      Promise.allSettled(PRECACHE.map((u) => cache.add(u)))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only handle same-origin requests; let Kakao/V2X/Overpass go straight through
  if (url.origin !== self.location.origin) return;

  // Navigation requests: network-first, fall back to cached "/"
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match("/").then((m) => m || caches.match(req)))
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // Only cache successful basic responses
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
