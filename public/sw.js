const CACHE_NAME = 'librovoz-v1';
const STATIC_ASSETS = [
  '/',
  '/css/variables.css',
  '/css/components.css',
  '/css/styles.css',
  '/css/scanner.css',
  '/css/player.css',
  '/js/app.js',
  '/js/api.js',
  '/js/scanner.js',
  '/js/ocr.js',
  '/js/processor.js',
  '/js/chapters.js',
  '/js/voices.js',
  '/js/player.js',
  '/js/tutorial.js',
  '/js/utils.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
