import { resolve } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

/** Public checks run from the Actions runner after local PM2 health succeeds. */
export async function verifyApiDeployment(apiBase, adminOrigin, { request = fetch, pause = setTimeout, attempts = 10 } = {}) {
  const base = new URL(apiBase)
  const admin = new URL(adminOrigin)
  if (!Number.isInteger(attempts) || attempts < 1 || base.protocol !== 'https:' || base.pathname !== '/api/v1' || base.username || base.password || base.search || base.hash || admin.protocol !== 'https:' || admin.origin !== adminOrigin || admin.origin === base.origin) {
    throw new Error('Configure the public HTTPS API base and a separate administration origin')
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const options = { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10_000) }
      const response = await request(new URL(base.href + '/health'), options)
      const health = (await response.json()).data
      if (!response.ok || !['ok', 'degraded'].includes(health?.status) || health.dependencies?.mysql !== 'up') {
        throw new Error('Public API health is not ready')
      }
      const preflight = async (origin) => request(new URL(base.href + '/admin/session'), {
        ...options,
        signal: AbortSignal.timeout(10_000),
        method: 'OPTIONS',
        headers: { 'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-admin-request' },
      })
      const allowed = await preflight(adminOrigin)
      if (!allowed.ok || allowed.headers.get('access-control-allow-origin') !== adminOrigin || allowed.headers.get('access-control-allow-credentials') !== 'true') {
        throw new Error('Administration origin or credentialed CORS is not configured')
      }
      const rejected = await preflight('https://untrusted.invalid')
      if (rejected.headers.get('access-control-allow-origin')) {
        throw new Error('Administration CORS accepts an untrusted origin')
      }
      if (health.dependencies?.redis === 'down') {
        console.warn('Optional Redis cache is unavailable; public API is ready with MySQL fallback.')
      }
      return
    } catch {
      if (attempt === attempts - 1) {
        throw new Error('Public API verification failed: check DNS, a trusted certificate covering the API domain, Nginx /api/ proxy, health and ADMIN_ORIGINS. PM2 may already be running; inspect the server before retrying.')
      }
      await pause(3000)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await verifyApiDeployment(process.env.API_BASE_URL, process.env.ADMIN_ORIGIN)
  console.info('Public HTTPS API and administration CORS verified.')
}
