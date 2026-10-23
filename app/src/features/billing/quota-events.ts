import { onBeforeUnmount, watch } from 'vue'
import { chatWebSocketUrl } from '../../core/network'
import { identity } from '../../core/session'
/** Re-read authoritative snapshots on push, reconnect and foreground; no balance arithmetic on the client. */
export function useQuotaRefresh(
  reload: () => Promise<unknown>,
  isActive: () => boolean = () => true,
) {
  let socket: WebSocket | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const schedule = () => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      void reload()
    }, 180)
  }
  const connect = () => {
    if (disposed || !isActive() || !identity.token || !navigator.onLine) {
      return
    }
    socket?.close()
    const token = identity.token
    let active: WebSocket
    try {
      active = new WebSocket(chatWebSocketUrl('/wallet/ws'))
    } catch {
      reconnect = setTimeout(connect, 5000)
      return
    }
    socket = active
    active.onopen = () => {
      if (socket !== active || token !== identity.token) {
        active.close()
        return
      }
      active.send(JSON.stringify({ type: 'authenticate', token }))
    }
    active.onmessage = (event) => {
      if (socket !== active || token !== identity.token) {
        return
      }
      try {
        const value: unknown = JSON.parse(event.data)
        if (
          value &&
          typeof value === 'object' &&
          'type' in value &&
          (value.type === 'ready' || value.type === 'quota.changed')
        ) {
          schedule()
        }
      } catch {
        active.close()
      }
    }
    active.onclose = () => {
      if (!disposed && socket === active) {
        reconnect = setTimeout(connect, 5000)
      }
    }
    active.onerror = () => active.close()
  }
  const stop = watch(
    [() => identity.token, isActive],
    () => {
      clearTimeout(reconnect)
      if (!identity.token || !isActive()) {
        socket?.close()
        socket = undefined
      } else {
        connect()
      }
    },
    { immediate: true },
  )
  const foreground = () => {
    if (isActive() && document.visibilityState === 'visible') {
      schedule()
      if (!socket || socket.readyState > WebSocket.OPEN) {
        connect()
      }
    }
  }
  const fallback = setInterval(() => {
    if (
      isActive() &&
      navigator.onLine &&
      document.visibilityState === 'visible' &&
      (!socket || socket.readyState !== WebSocket.OPEN)
    ) {
      schedule()
    }
  }, 30000)
  window.addEventListener('online', foreground)
  document.addEventListener('visibilitychange', foreground)
  onBeforeUnmount(() => {
    disposed = true
    stop()
    socket?.close()
    clearTimeout(reconnect)
    clearTimeout(debounce)
    clearInterval(fallback)
    window.removeEventListener('online', foreground)
    document.removeEventListener('visibilitychange', foreground)
  })
}
