// Service worker template. Filled in at build time by vite.config.js (version and file list).
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const APP = 'hl2-app-' + VERSION;
const RUNTIME = 'hl2-runtime';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('hl2-app-') && k !== APP).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // App files: cache first, then network. Page navigations fall back to the cached shell when offline.
    e.respondWith((async () => {
      const hit = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      try { return await fetch(req); }
      catch (err) { if (req.mode === 'navigate') { const shell = await caches.match('./index.html') || await caches.match('./'); if (shell) return shell; } throw err; }
    })());
  } else if (/cdnjs\.cloudflare\.com/.test(url.hostname)) {
    // The classic map loads three.js from a CDN: keep a copy after the first online visit.
    e.respondWith((async () => {
      const c = await caches.open(RUNTIME);
      const hit = await c.match(req);
      const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
});
