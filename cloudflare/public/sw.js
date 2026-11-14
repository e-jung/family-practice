/* Bump VERSION for each shell release. Never cache family URLs or API data on disk. */
const VERSION = 'v1';
const PREFIX = 'family-practice-shell-';
const SHELL_CACHE = PREFIX + VERSION;
const SHELL = ['/', '/index.html', '/style.css', '/app.js', '/learn.js', '/pwa.js', '/manifest.webmanifest', '/icons/icon-180.png', '/icons/icon-192.png', '/icons/icon-512.png'];
const ttsMemory = new Map();
const TTS_LIMIT = 24;
const TTS_BYTES = 512 * 1024;
const TTS_TTL = 10 * 60 * 1000;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)));
  // No skipWaiting: don't mix new assets with a currently running practice session.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith(PREFIX) && name !== SHELL_CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});
async function speech(request, clientId) {
  // Session-memory only; bounded to 12 MiB total, scoped to client AND family.
  // Do not persist text, family codes, or audio in CacheStorage.
  const key = JSON.stringify([clientId, request.headers.get('X-Family-Code'), request.url]);
  const prior = ttsMemory.get(key);
  if (prior && Date.now() - prior.time < TTS_TTL) {
    ttsMemory.delete(key); ttsMemory.set(key, prior);
    return prior.response.clone();
  }
  ttsMemory.delete(key);
  const response = await fetch(request, { cache: 'no-store' });
  if (response.ok && /audio\/mpeg/i.test(response.headers.get('Content-Type') || '')) {
    const bytes = await response.clone().arrayBuffer();
    if (bytes.byteLength > 0 && bytes.byteLength <= TTS_BYTES) {
      ttsMemory.set(key, { response: new Response(bytes, { headers: response.headers }), time: Date.now() });
      while (ttsMemory.size > TTS_LIMIT) ttsMemory.delete(ttsMemory.keys().next().value);
    }
  }
  return response;
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(request.method === 'GET' && url.pathname === '/api/tts'
      ? speech(request, event.clientId)
      : fetch(request, { cache: 'no-store' }));
    return;
  }
  if (request.method !== 'GET') return;
  // All navigations use the generic shell, never store /f/<private-code> or query strings.
  if (request.mode === 'navigate') {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (await cache.match('/')) || fetch(request)));
  } else if (!url.search && SHELL.includes(url.pathname)) {
    event.respondWith(caches.open(SHELL_CACHE).then(async cache => (await cache.match(url.pathname)) || fetch(request)));
  }
});
