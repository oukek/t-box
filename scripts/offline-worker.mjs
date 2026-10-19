/* global caches */
/** Generate a public-static-only worker. No API responses, tokens or SDK data enter Cache Storage. */
export function createOfflineWorker(manifest) {
  function worker(manifest) {
    const scope = new URL(globalThis.registration.scope)
    const prefix = `tbox-static-v1:${scope.pathname}:`
    const name = prefix + manifest.version
    const url = (path) => new URL(path, scope).href
    const packageName = `tbox-package-v1:${scope.pathname}`
    const marker = url('__tbox_complete__')
    const shellMarker = url('__tbox_shell_complete__')
    globalThis.addEventListener('install', (event) => {
      event.waitUntil((async () => {
        const cache = await caches.open(name)
        try {
          for (const file of manifest.files) {
            const prepared = manifest.application ? await caches.open(packageName) : null
            const ready = prepared && await prepared.match(marker)
            const response = (ready && await prepared.match(url(file.path))) || await fetch(url(file.path), { credentials: 'omit', cache: 'no-store', redirect: 'error' })
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
          if (!manifest.application) {
            await cache.put(shellMarker, new Response(manifest.version))
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
      const file = manifest.files.find((file) => file.path === path || (!path && file.path === 'index.html'))
      if (!target.pathname.startsWith(scope.pathname)) {
        return
      }
      if (!file) {
        // A waiting shell worker may have fully verified a newer hashed bundle while this page
        // is still controlled by the previous worker. Never let this version boundary break offline refresh.
        if (!manifest.application && /^assets\/[\w.@/-]+$/.test(path) && !path.split('/').includes('..')) {
          event.respondWith((async () => {
            for (const key of (await caches.keys()).filter((key) => key.startsWith(prefix)).reverse()) {
              const completed = await caches.open(key)
              if (await completed.match(shellMarker)) {
                const cached = await completed.match(url(path))
                if (cached) {
                  return cached
                }
              }
            }
            return fetch(request)
          })())
        }
        return
      }
      const key = url(path || 'index.html')
      event.respondWith((async () => {
        const cache = await caches.open(name)
        // Application URLs contain immutable digests. A prepared version never waits for the network.
        // The mutable host shell retains network-first navigation so shell deployments can update.
        if (request.mode === 'navigate' && !manifest.application) {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), 2000)
          try {
            const response = await fetch(request, { signal: controller.signal })
            return response.ok ? response : await cache.match(key) || response
          } catch {
            return await cache.match(key) || Response.error()
          } finally {
            clearTimeout(timer)
          }
        }
        if (!manifest.application) {
          return await cache.match(key) || fetch(request)
        }
        const prepared = await caches.open(packageName)
        const cached = await cache.match(key) || (await prepared.match(marker) && await prepared.match(key))
        try {
          const response = cached || await fetch(request, { credentials: 'omit', redirect: 'error' })
          if (!response.ok || response.type === 'opaque') {
            return Response.error()
          }
          const bytes = await response.clone().arrayBuffer()
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join('')
          if (digest !== file.sha256) {
            return Response.error()
          }
          if (!cached) {
            await cache.put(key, response.clone())
          }
          return response
        } catch {
          return Response.error()
        }
      })())
    })
  }
  return `(${worker.toString()})(${JSON.stringify(manifest)});\n`
}
