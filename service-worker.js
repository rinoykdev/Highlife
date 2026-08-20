/* =========================================================
   service-worker.js
   Cache-first for the shell (the whole game is the shell),
   with a network fallback that repopulates the cache. Bump
   CACHE_VERSION on every deploy to roll users forward.
   ========================================================= */

const CACHE_VERSION = 'highline-v1.0.0';

/* Relative paths so the app works from a GitHub Pages subfolder. */
const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.json',
  './js/main.js',
  './js/game.js',
  './js/ui.js',
  './js/physics.js',
  './js/environment.js',
  './js/character.js',
  './js/input.js',
  './js/audio.js',
  './js/storage.js',
  './js/content.js',
  './lib/three.module.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './assets/loc-summit.png',
  './assets/loc-eagle.png',
  './assets/loc-cloud.png',
  './assets/loc-golden.png',
  './assets/loc-misty.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // addAll is all-or-nothing; add individually so one 404 cannot
    // block the whole install.
    await Promise.all(PRECACHE.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); }
      catch (e) { console.warn('[sw] skipped', url, e); }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: serve the app shell so deep links work offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_VERSION);
        cache.put('./index.html', fresh.clone());
        return fresh;
      } catch (e) {
        const cache = await caches.open(CACHE_VERSION);
        return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.status === 200 && fresh.type === 'basic') cache.put(req, fresh.clone());
      return fresh;
    } catch (e) {
      return hit || Response.error();
    }
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});
