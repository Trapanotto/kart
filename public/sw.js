// Keeps downloaded game files on the device, so the next visit starts without re-downloading.
// Only URLs whose content can never change are stored: assets with a content hash (?v=…) and the
// hashed script files of the build. Everything else (the page itself) always comes from the network.
const CACHE = 'tk-assets-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const hashedAsset = url.searchParams.has('v');
  const hashedBuild = /\/assets\/[^/]+-[\w-]{8,}\.(js|css|wasm)$/.test(url.pathname);
  if (!hashedAsset && !hashedBuild) return;
  e.respondWith((async () => {
    // Any trouble with the cache must never break the game: fall back to the network.
    let cache = null;
    try {
      cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
    } catch { cache = null; }
    const res = await fetch(req);
    if (cache && res.ok && res.status === 200) {
      const store = cache, copy = res.clone();
      // a new version of an asset replaces the old one
      (hashedAsset ? store.delete(req, { ignoreSearch: true }) : Promise.resolve())
        .then(() => store.put(req, copy)).catch(() => {});
    }
    return res;
  })());
});
