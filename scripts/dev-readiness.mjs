import { setTimeout } from 'node:timers/promises'

/**
 * A listening port alone does not mean database connections and app registration
 * are ready. Redis may be degraded because it is an optional cache.
 */
export async function waitForApi({
  url = 'http://127.0.0.1:3000/api/v1/health',
  timeout = 90_000,
  interval = 300,
  signal,
} = {}) {
  const deadline = Date.now() + timeout
  do {
    signal?.throwIfAborted()
    try {
      const requestSignal = AbortSignal.timeout(Math.max(1, Math.min(1500, deadline - Date.now())))
      const response = await fetch(url, {
        signal: signal ? AbortSignal.any([signal, requestSignal]) : requestSignal,
        redirect: 'error',
      })
      const body = response.ok ? await response.json() : null
      if (body?.data?.dependencies?.mysql === 'up') {
        return
      }
    } catch { /* Startup is in progress; do not print repeated connection errors. */ }
    if (Date.now() < deadline) {
      await setTimeout(Math.min(interval, deadline - Date.now()), undefined, { signal })
    }
  } while (Date.now() < deadline)
  throw new Error(`API 在 ${Math.ceil(timeout / 1000)} 秒内未就绪，请查看上方 [api] 错误，确认 MySQL 已启动、api/.env 和数据库结构正确。已有数据库不要重复初始化。详见 docs/local-execution-and-development.md。`)
}
