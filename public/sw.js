// Cache only this application's static shell. Never intercept account or database requests.
const CACHE = 'leaksy-static-v6'
const scope = new URL(self.registration.scope)
const shell = [scope.href, new URL('manifest.webmanifest', scope).href]
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(shell)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('leaksy-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', event => {
  const req = event.request, url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || req.headers.has('authorization')) return
  const navigation = req.mode === 'navigate'
  const asset = /\.(?:js|mjs|css|woff2?|png|svg|ico|webmanifest|wasm|tar|gz)$/.test(url.pathname)
  if (!navigation && !asset) return
  const key = navigation ? scope.href : req
  event.respondWith((async () => {
    if (!navigation) { const cached = await caches.match(key); if (cached) return cached }
    return fetch(req).then(response => {
    if (response.ok && response.type === 'basic') event.waitUntil(caches.open(CACHE).then(cache => cache.put(key, response.clone())).catch(() => {}))
    return response
  }).catch(async () => (await caches.match(key)) || Response.error())
  })())
})
