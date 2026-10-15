/* global caches */
/** Generate a public-static-only worker. No API responses, tokens or SDK data enter Cache Storage. */
export function createOfflineWorker(manifest) {
  function worker(manifest) {
    const scope = new URL(globalThis.registration.scope)
    const prefix = `tbox-static-v1:${scope.pathname}:`
    const name = prefix + manifest.version
    const url = (path) => new URL(path, scope).href
    globalThis.addEventListener('install', (event) => {
      event.waitUntil((async () => {
        const cache = await caches.open(name)
        try {
          for (const file of manifest.files) {
            const response = await fetch(url(file.path), { credentials: 'omit', cache: 'no-store', redirect: 'error' })
            if (!response.ok || response.type === 'opaque') {
              throw new Error('Static asset unavailable')
            }
            const bytes = await response.clone().arrayBuffer()
            const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
            if (digest !== file.sha256) {
              throw new Error('Static asset integrity mismatch')
            }
            await cache.put(url(file.path), response)
          }
        } catch (error) {
          await caches.delete(name)
          throw error
        }
      })())
      // No skipWaiting: an update never takes over a running version mid-session.
    })
    globalThis.addEventListener('activate', (event) => {
      event.waitUntil((async () => {
        const previous = (await caches.keys()).filter((key) => key.startsWith(prefix) && key !== name)
        for (const key of previous.slice(0, -1)) {
          await caches.delete(key)
        }
      })())
    })
    globalThis.addEventListener('fetch', (event) => {
      const request = event.request
      const target = new URL(request.url)
      if (request.method !== 'GET' || target.origin !== scope.origin) {
        return
      }
      const path = target.pathname.slice(scope.pathname.length)
      if (!target.pathname.startsWith(scope.pathname) || !manifest.files.some((file) => file.path === path || (!path && file.path === 'index.html'))) {
        return
      }
      const key = url(path || 'index.html')
      event.respondWith((async () => {
        const cache = await caches.open(name)
        if (request.mode === 'navigate') {
          try {
            return await fetch(request)
          } catch {
            return await cache.match(key) || Response.error()
          }
        }
        return await cache.match(key) || fetch(request)
      })())
    })
  }
  return `(${worker.toString()})(${JSON.stringify(manifest)});\n`
}
