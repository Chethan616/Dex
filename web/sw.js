/**
 * Service worker — app-shell cache only, so the PWA opens offline and shows its
 * "offline" link state instead of a browser error. It never caches a mesh
 * frame; those are live, sealed, and none of the cache's business.
 */
const CACHE = 'dex-mesh-v1';
const SHELL = [
  '.',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'js/protocol.js',
  'js/crypto.js',
  'js/store.js',
  'js/mesh.js',
  'js/app.js',
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }),
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  // Only ever serve the shell from cache. Everything else — and there is
  // nothing else, the relay link is a WebSocket — goes to the network.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request);
    }),
  );
});
