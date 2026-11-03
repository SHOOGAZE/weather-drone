/* Weather Drone · service worker
   - the app's own files: network first (so a new version on GitHub Pages shows up straight away),
     falling back to the cache when offline or when the network is too slow
   - Google Fonts: served from the cache, refreshed in the background
   - weather and place-name requests are never cached: stale weather would be wrong weather */
'use strict';

// bump VERSION with each release so old caches are cleared; add new files to SHELL
const VERSION = 'wd-2026-11-03';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/style.css',
  'js/strings.js', 'js/core.js', 'js/audio.js', 'js/sky.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];
const FONT_CACHE = 'wd-fonts';
const NETWORK_TIMEOUT = 4000;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return new Promise(resolve => {
    let settled = false;
    const fromCache = () => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'));
    const timer = setTimeout(() => fromCache().then(r => { if (r && !settled) { settled = true; resolve(r); } }), NETWORK_TIMEOUT);
    fetch(req).then(res => {
      if (res && res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      clearTimeout(timer);
      if (!settled) { settled = true; resolve(res); }
    }).catch(() => {
      clearTimeout(timer);
      fromCache().then(r => { if (!settled) { settled = true; resolve(r || Response.error()); } });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(FONT_CACHE).then(c => c.match(req).then(hit => {
    const fresh = fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || fresh;
  }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') { e.respondWith(staleWhileRevalidate(req)); return; }
  // everything else (Open-Meteo, BigDataCloud) goes straight to the network
});
