const CACHE = 'meal-prep-v5';
const STATIC = ['./index.html', './app.js', './style.css', './chart.min.js', './icon.svg', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Firebase, CDN, and cross-origin requests: let them go through normally
  if (url.origin !== location.origin) return;

  // App shell (navigations + JS/CSS): network-first so new deploys go live
  // immediately. Falls back to cache only when offline.
  const isAppShell =
    e.request.mode === 'navigate' ||
    /\.(?:js|css|html)$/.test(url.pathname);

  if (isAppShell) {
    // `no-store` forces a fresh server fetch (bypasses the browser HTTP cache),
    // so a new deploy is never masked by a stale cached app.js/style.css.
    e.respondWith(
      fetch(new Request(e.request, { cache: 'no-store' }))
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Other same-origin assets (icons, manifest, images): stale-while-revalidate.
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return res;
      });
      return cached || networkFetch;
    })
  );
});

// Notification click. The app raises these from the page (see maybeNotifyAttention
// in app.js) via registration.showNotification(), because Android Chrome forbids
// the page-side Notification constructor. This worker does NOT schedule or send
// anything on its own — there is no push server behind this app. It only routes
// the tap back to the Needs Attention view.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clients) {
      if (c.url.startsWith(self.registration.scope)) {
        await c.focus();
        c.postMessage({ type: 'show-attention' });
        return;
      }
    }
    await self.clients.openWindow(self.registration.scope);
  })());
});
