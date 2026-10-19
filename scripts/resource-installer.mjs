/** Runs on the application's origin, never in application business code. */
export function createResourceInstaller() {
  function installer() {
    const parentOrigin = new URL(location.href).searchParams.get('host')
    const nonce = new URL(location.href).searchParams.get('nonce')
    const base = new URL('./', location.href)
    const digest = base.pathname.split('/').filter(Boolean).at(-1)
    const appId = base.pathname.split('/').filter(Boolean).at(-2)
    const sha = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((v) => v.toString(16).padStart(2, '0')).join('')
    const send = (value) => parent.postMessage({ protocol: 'tbox.resources.v1', nonce, digest, ...value }, parentOrigin)
    const key = `tbox-package-v1:${base.pathname}`
    const complete = new URL('__tbox_complete__', base).href
    const validPath = (path) => typeof path === 'string' && path.length <= 240 && !/[^\w./@-]/.test(path) && path.split('/').every((part) => part && part !== '.' && part !== '..') && path !== 'artifact.json'
    async function run() {
      if (!parentOrigin || !nonce || !/^[a-f0-9]{64}$/.test(digest || '') || !/^[a-z][\w-]{0,63}$/.test(appId || '')) {
        throw new Error('应用资源地址无效')
      }
      if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) {
        send({ status: 'unsupported' })
        return
      }
      send({ status: 'available' })
      if (new URL(location.href).searchParams.get('remove') === '1') {
        await caches.delete(key)
        const registration = await navigator.serviceWorker.getRegistration(base.href)
        if (registration?.scope === base.href) {
          await registration.unregister()
        }
        for (const name of await caches.keys()) {
          if (name.startsWith(`tbox-static-v1:${base.pathname}:`)) {
            await caches.delete(name)
          }
        }
        send({ status: 'removed' })
        return
      }
      const cache = await caches.open(key)
      let marker = await cache.match(complete)
      if (!marker) {
        if (!navigator.onLine) {
          throw new Error('本机没有完整的应用资源，请联网打开一次后再离线使用')
        }
        const response = await fetch(new URL('artifact.json', base), { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
        if (!response.ok) {
          throw new Error('应用资源清单下载失败，请重新发布应用')
        }
        const text = await response.text()
        if (text.length > 1024 * 1024) {
          throw new Error('应用资源清单过大')
        }
        const manifest = JSON.parse(text)
        if (manifest.protocol !== 1 || manifest.appId !== appId || manifest.digest !== digest || !manifest.files || Array.isArray(manifest.files) || await sha(new TextEncoder().encode(JSON.stringify(manifest.files))) !== digest) {
          throw new Error('应用资源清单校验失败')
        }
        const files = Object.entries(manifest.files)
        if (!files.length || files.length > 2000 || !manifest.files['index.html'] || files.some(([path, hash]) => !validPath(path) || typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) {
          throw new Error('应用资源清单无效')
        }
        // A digest-specific cache is invisible to the worker until its completion marker exists.
        let cursor = 0
        let bytes = 0
        let done = 0
        try {
          await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
            for (;;) {
              const file = files[cursor++]
              if (!file) {
                return
              }
              const url = new URL(file[0], base).href
              const result = await fetch(url, { credentials: 'omit', cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000) })
              if (!result.ok || Number(result.headers.get('content-length')) > 5 * 1024 * 1024) {
                throw new Error('应用资源下载失败')
              }
              const value = await result.arrayBuffer()
              bytes += value.byteLength
              if (value.byteLength > 5 * 1024 * 1024 || bytes > 20 * 1024 * 1024 || await sha(value) !== file[1]) {
                throw new Error('应用资源校验失败')
              }
              const headers = new Headers(result.headers)
              headers.delete('content-encoding')
              headers.delete('content-length')
              headers.delete('transfer-encoding')
              await cache.put(url, new Response(value, { headers }))
              send({ status: 'progress', completed: ++done, total: files.length, bytes })
            }
          }))
          await cache.put(complete, new Response(JSON.stringify({ digest, files: files.length, bytes })))
          marker = await cache.match(complete)
        } catch (error) {
          await caches.delete(key)
          throw error
        }
      }
      const existing = await navigator.serviceWorker.getRegistration(base.href)
      const registration = existing?.scope === base.href && existing.active ? existing : await navigator.serviceWorker.register(new URL('tbox-offline-sw.js', base), { scope: base.pathname, updateViaCache: 'none' })
      const worker = registration.installing || registration.waiting || registration.active
      if (!worker) {
        throw new Error('应用本地资源服务不可用')
      }
      if (worker.state !== 'activated') {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('应用缓存启用超时')), 30_000)
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'redundant') {
              clearTimeout(timer)
              worker.state === 'activated' ? resolve() : reject(new Error('应用缓存启用失败'))
            }
          })
        })
      }
      send({ status: 'ready', ...await marker.json() })
    }
    run().catch((error) => send(['SecurityError', 'NotAllowedError', 'QuotaExceededError'].includes(error.name)
      ? { status: 'unsupported' }
      : { status: 'failed', message: error.message || '应用资源准备失败' }))
  }
  return `(${installer.toString()})();\n`
}
