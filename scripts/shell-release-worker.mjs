/* global caches */
// The release protocol reports preparation progress and activates the requested build.
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
  }
  return `(${shell.toString()})(${JSON.stringify(version)},${JSON.stringify(build)},${JSON.stringify(total)});\n`
}
