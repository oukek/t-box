import { watch } from 'vue'
import { chatWebSocketUrl } from '../network'
import { identity } from '../session'
import { appCatalog, refreshCatalog } from './catalog'

/** One platform connection for OS, market and every open application. */
export function startCatalogSync() {
  let epoch = 0
  let socket: WebSocket | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let failures = 0
  let connected = false
  let lastRevision = ''
  let lastMessage = 0
  let pending: Promise<void> | undefined
  let dirty = false
  let disposed = false
  const reload = () => {
    if (disposed || !identity.user) {
      return
    }
    if (pending) {
      dirty = true
      return
    }
    pending = refreshCatalog({ silent: true }).finally(() => {
      pending = undefined
      if (dirty) {
        dirty = false
        reload()
      }
    })
  }
  const scheduleReload = () => {
    clearTimeout(debounce)
    debounce = setTimeout(reload, 150)
  }
  const disconnect = () => {
    connected = false
    clearTimeout(reconnect)
    clearTimeout(debounce)
    clearInterval(heartbeat)
    const previous = socket
    socket = undefined
    previous?.close()
  }
  const connect = () => {
    if (disposed || !identity.user || !identity.token || !navigator.onLine) {
      return
    }
    const started = epoch
    const token = identity.token
    let active: WebSocket
    try {
      active = new WebSocket(chatWebSocketUrl('/app-market/ws'))
    } catch {
      reconnect = setTimeout(connect, 30_000)
      return
    }
    socket = active
    active.onopen = () => {
      if (started !== epoch || token !== identity.token) {
        active.close()
        return
      }
      active.send(JSON.stringify({ type: 'authenticate', token }))
      lastMessage = Date.now()
    }
    active.onmessage = (event) => {
      if (started !== epoch || socket !== active) {
        return
      }
      try {
        const value = JSON.parse(event.data)
        lastMessage = Date.now()
        if (value.type === 'ready') {
          connected = true
          failures = 0
          scheduleReload()
          clearInterval(heartbeat)
          heartbeat = setInterval(() => {
            if (Date.now() - lastMessage > 45_000) {
              active.close()
            } else if (active.readyState === WebSocket.OPEN) {
              active.send(JSON.stringify({ type: 'ping' }))
            }
          }, 20_000)
        } else if (value.type === 'catalog.changed' && typeof value.revision === 'string' && value.revision !== lastRevision) {
          lastRevision = value.revision
          scheduleReload()
        }
      } catch {
        active.close()
      }
    }
    active.onclose = () => {
      if (started !== epoch || socket !== active || disposed) {
        return
      }
      connected = false
      clearInterval(heartbeat)
      socket = undefined
      reconnect = setTimeout(connect, Math.min(30_000, 1000 * 2 ** Math.min(failures++, 5)) + Math.random() * 300)
    }
    active.onerror = () => active.close()
  }
  const stopWatch = watch(() => [identity.user?.id, identity.token] as const, () => {
    epoch++
    dirty = false
    lastRevision = ''
    failures = 0
    disconnect()
    void refreshCatalog()
    connect()
  }, { immediate: true })
  const foreground = () => {
    if (document.visibilityState !== 'visible' || !identity.user) {
      return
    }
    reload()
    if (!socket || socket.readyState > WebSocket.OPEN) {
      clearTimeout(reconnect)
      connect()
    }
  }
  const offline = () => {
    epoch++
    disconnect()
  }
  let lastFallback = 0
  const fallback = setInterval(() => {
    if (!navigator.onLine || document.visibilityState !== 'visible') {
      return
    }
    const processing = appCatalog.entries.some((entry) => entry.installation?.status === 'installing' || (entry.release.kind === 'system' && entry.installation?.status === 'failed'))
    // Bootstrap retries failed system installs; their unchanged DB state emits no new hint.
    if (processing || appCatalog.stale || (!connected && Date.now() - lastFallback >= 60_000)) {
      lastFallback = Date.now()
      reload()
    }
  }, 10_000)
  window.addEventListener('online', foreground)
  window.addEventListener('offline', offline)
  document.addEventListener('visibilitychange', foreground)
  window.addEventListener('focus', foreground)
  return () => {
    disposed = true
    epoch++
    stopWatch()
    disconnect()
    clearInterval(fallback)
    window.removeEventListener('online', foreground)
    window.removeEventListener('offline', offline)
    window.removeEventListener('focus', foreground)
    document.removeEventListener('visibilitychange', foreground)
  }
}
