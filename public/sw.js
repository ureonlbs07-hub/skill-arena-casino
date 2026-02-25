const CACHE_NAME = 'skill-arena-v1'
const ASSETS = [
  '/',
  '/index.html',
  '/socket.io/socket.io.js'
]

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  )
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    })
  )
})

self.addEventListener('fetch', (e) => {
  if (e.request.url.includes('socket.io')) return
  e.respondWith(
    caches.match(e.request).then((res) => res || fetch(e.request))
  )
})