// Offline support: serve the app from cache, refresh the cache in the background.
// Bump VERSION whenever the app's files change so clients pick up the update.
const VERSION = 'v5';
const CACHE = 'lrcb-companion-' + VERSION;
const FILES = [
  './', 'index.html', 'styles.css', 'polyfills.js', 'app.js', 'lib.js', 'vendor/qrcode.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-512-maskable.png',
  // Card PDF import (loaded on demand, cached so it also works offline)
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/pdf.worker.polyfilled.mjs',
  'vendor/zxing/zxing-reader.js', 'vendor/zxing/zxing_reader.wasm',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('lrcb-companion-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(request, { ignoreSearch: true })
      || (request.mode === 'navigate' ? await cache.match('index.html') : undefined);
    const network = fetch(request).then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    }).catch(() => cached);
    return cached || network;
  }));
});
