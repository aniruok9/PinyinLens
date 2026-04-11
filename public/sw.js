// Service worker: injects COOP/COEP headers for SharedArrayBuffer support
// (GitHub Pages cannot set these headers server-side)

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const headers = new Headers(res.headers);
        headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
        headers.set('Cross-Origin-Opener-Policy', 'same-origin');
        return new Response(res.body, {
          status: res.status,
          statusText: res.statusText,
          headers,
        });
      })
    );
  }
});
