import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { discoverApplications } from './application-builds.mjs'

/** Same-origin dev diagnostics. Targets come only from trusted repository declarations, never request URLs. */
export function developmentApplicationStatus(root) {
  return {
    name: 'tbox-development-application-status',
    apply: 'serve',
    async configureServer(server) {
      const targets = new Map()
      for (const config of await discoverApplications(root)) {
        try {
          const release = (await import(pathToFileURL(join(root, 'apps', config.appId, config.releaseModule)).href))[config.releaseExport]
          const url = release.runtime?.type === 'web' ? new URL(release.runtime.entryUrl) : null
          if (url && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:') {
            targets.set(config.appId, url)
          }
        } catch { /* A package without compiled metadata can still use the normal iframe diagnostic. */ }
      }
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', 'http://localhost')
        if (url.pathname !== '/__tbox/application-status') {
          return next()
        }
        const target = targets.get(url.searchParams.get('appId'))
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (!target || request.method !== 'GET') {
          response.statusCode = 404
          response.end('{}')
          return
        }
        let ready = false
        try {
          ready = (await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(2000) })).ok
        } catch { /* Report the stopped Vite service, without confusing CORS/CSP with server reachability. */ }
        response.end(JSON.stringify({ ready, origin: target.origin }))
      })
    },
  }
}
