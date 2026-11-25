/* global caches */
// Install this listener before the general offline handler, for the versioned host entry only.
export function createShellReleaseWorker(version, build, total) {
  function shell(version, build, total) {
    const scope = new URL(globalThis.registration.scope)
    globalThis.addEventListener('message', (event) => {
      if (event.data?.type === 'web-release-progress' && event.data.build === build && event.ports[0]) {
        event.waitUntil((async () => {
          const cache = await caches.open('tbox-static-v1:' + scope.pathname + ':' + version)
          const keys = await cache.keys()
          const marker = new URL('__tbox_shell_complete__', scope).href
          const completed = keys.filter((key) => key.url !== marker).length
          event.ports[0].postMessage({ completed, total })
        })())
      }
      if (event.data?.type === 'activate-web-release') {
        const matches = event.data.build === build
        event.ports[0]?.postMessage(matches)
        if (matches) {
          event.waitUntil(globalThis.skipWaiting())
        }
      }
    })
    globalThis.addEventListener('fetch', (event) => {
      const request = event.request
      const url = new URL(request.url)
      if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== scope.origin ||
        (url.pathname !== scope.pathname && url.pathname !== scope.pathname + 'index.html')) {
        return
      }
      event.stopImmediatePropagation()
      event.respondWith((async () => {
        const cache = await caches.open('tbox-static-v1:' + scope.pathname + ':' + version)
        return await cache.match(new URL('index.html', scope).href) || fetch(request)
      })())
    })
  }
  return `(${shell.toString()})(${JSON.stringify(version)},${JSON.stringify(build)},${JSON.stringify(total)});\n`
}
