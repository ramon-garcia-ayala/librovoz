const CACHE_NAME = 'librovoz-v9';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon-32.png',
  '/css/variables.css',
  '/css/components.css',
  '/css/styles.css',
  '/css/scanner.css',
  '/css/player.css',
  '/css/library.css',
  '/css/paywall.css',
  '/js/app.js',
  '/js/api.js',
  '/js/scanner.js',
  '/js/ocr.js',
  '/js/processor.js',
  '/js/chapters.js',
  '/js/voices.js',
  '/js/player.js',
  '/js/tutorial.js',
  '/js/utils.js',
  '/js/db.js',
  '/js/library.js',
  '/js/limits.js',
  '/js/quota.js',
  '/js/paywall.js',
  '/js/tesseract-ocr.js',
  '/js/pdf-extract.js',
  '/js/chat.js',
  '/js/microcopy.js',
  '/js/book-io.js',
  '/css/chat.css',
  '/lib/tesseract/tesseract.min.js',
  '/lib/tesseract/worker.min.js',
  '/pages/library.html',
  '/pages/paywall.html',
  '/pages/chat.html'
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
