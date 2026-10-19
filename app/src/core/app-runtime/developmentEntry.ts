import { ErrorCode } from '../../error-codes'

/** Development containers require their own Vite service; never forward account headers to that origin. */
export async function checkDevelopmentEntry(appId: string, entryUrl: string, fetcher: typeof fetch = fetch) {
  const url = new URL(entryUrl)
  let ready: boolean | undefined
  try {
    const response = await fetcher(`/__tbox/application-status?appId=${encodeURIComponent(appId)}`, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(2500) })
    if (response.ok) {
      const data: unknown = await response.json()
      ready = data && typeof data === 'object' && 'ready' in data && typeof data.ready === 'boolean' ? data.ready : undefined
    }
  } catch { /* Diagnostic availability must never block a working application. */ }
  if (ready === false) {
    throw ErrorCode.INTERNAL_DEVELOPMENT_APP_UNAVAILABLE(`无法连接应用开发服务 ${url.origin}。请运行 pnpm dev（全部服务）或 pnpm dev:apps，然后重新打开`)
  }
}
