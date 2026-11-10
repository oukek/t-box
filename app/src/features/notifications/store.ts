import type { NotificationInbox, SystemNotification } from '@t-box/app-contracts'
import { reactive, watch } from 'vue'
import { chatWebSocketUrl, request } from '../../core/network'
import { identity } from '../../core/session'

export const notifications = reactive({
  open: false,
  filter: 'all' as 'all' | 'unread',
  items: [] as SystemNotification[],
  ready: false,
  toast: null as SystemNotification | null,
  unread: 0,
  nextCursor: null as string | null,
  loading: false,
  error: '',
})
let epoch = 0
let revision = 0
const known = new Set<string>()
let controller: AbortController | undefined
export function openNotifications() {
  notifications.open = true
  notifications.toast = null
  void loadNotifications()
}
export async function loadNotifications(append = false, announce = false) {
  if (!identity.user || !navigator.onLine || (append && (!notifications.nextCursor || notifications.loading))) {
    return
  }
  controller?.abort()
  const current = ++revision
  const account = epoch
  const filter = notifications.filter
  const params = new URLSearchParams({ filter })
  if (append && notifications.nextCursor) {
    params.set('cursor', notifications.nextCursor)
  }
  controller = new AbortController()
  notifications.loading = true
  notifications.error = ''
  try {
    // Preserve loaded pages during invalidation/read updates instead of jumping back to page one.
    const wanted = append ? 30 : Math.max(30, notifications.items.length)
    const items: SystemNotification[] = []
    let data: NotificationInbox
    do {
      data = (await request<{ data: NotificationInbox }>(`/notifications?${params}`, { signal: controller.signal })).data
      items.push(...data.items)
      if (data.nextCursor) {
        params.set('cursor', data.nextCursor)
      }
      if (append || current !== revision || account !== epoch || filter !== notifications.filter) {
        break
      }
    } while (data.nextCursor && items.length < wanted)
    if (current !== revision || account !== epoch || filter !== notifications.filter) {
      return
    }
    const incoming = items.find((item) => !known.has(item.id) && !item.read && item.kind !== 'reminder')
    if (announce && notifications.ready && !notifications.open && document.visibilityState === 'visible' && incoming) {
      notifications.toast = incoming
    }
    for (const item of items) {
      known.add(item.id)
    }
    if (known.size > 1000) {
      const recent = [...known].slice(-500)
      known.clear()
      recent.forEach((id) => known.add(id))
    }
    notifications.ready = true
    notifications.items = [...new Map([...(append ? notifications.items : []), ...items].map((item) => [item.id, item])).values()]
    notifications.unread = data.unread
    notifications.nextCursor = data.nextCursor
  } catch (cause) {
    if (current === revision && account === epoch) {
      notifications.error = cause instanceof Error ? cause.message : '通知暂时不可用，请重试'
    }
  } finally {
    if (current === revision && account === epoch) {
      notifications.loading = false
    }
  }
}
export async function markNotification(id?: string, read = true) {
  const account = epoch
  await request(id ? `/notifications/${encodeURIComponent(id)}/read` : '/notifications/read', {
    method: 'PATCH',
    ...(id ? { body: JSON.stringify({ read }) } : {}),
  })
  if (account === epoch) {
    await loadNotifications()
  }
}

/** One authenticated invalidation stream for every surface. Foreground HTTP is the offline fallback. */
export function startNotificationSync() {
  let disposed = false
  let socket: WebSocket | undefined
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let heartbeat: ReturnType<typeof setInterval> | undefined
  let debounce: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let lastMessage = 0
  const disconnect = () => {
    clearTimeout(reconnect)
    clearTimeout(debounce)
    clearInterval(heartbeat)
    const old = socket
    socket = undefined
    old?.close()
  }
  const refresh = (announce = false) => {
    clearTimeout(debounce)
    debounce = setTimeout(() => {
      void loadNotifications(false, announce)
    }, 150)
  }
  const connect = () => {
    if (disposed || !identity.user || !identity.token || !navigator.onLine || socket) {
      return
    }
    const account = epoch
    const token = identity.token
    let active: WebSocket
    try {
      active = new WebSocket(chatWebSocketUrl('/notifications/ws'))
    } catch {
      reconnect = setTimeout(connect, 30000)
      return
    }
    socket = active
    active.onopen = () => {
      if (account !== epoch || token !== identity.token) {
        active.close()
        return
      }
      lastMessage = Date.now()
      active.send(JSON.stringify({ type: 'authenticate', token }))
    }
    active.onmessage = (event) => {
      if (account !== epoch || socket !== active) {
        return
      }
      lastMessage = Date.now()
      try {
        const value = JSON.parse(event.data)
        if (value.type === 'ready') {
          failures = 0
          refresh()
          clearInterval(heartbeat)
          heartbeat = setInterval(() => {
            if (Date.now() - lastMessage > 45000) {
              active.close()
            } else if (active.readyState === WebSocket.OPEN) {
              active.send(JSON.stringify({ type: 'ping' }))
            }
          }, 20000)
        } else if (value.type === 'notifications.changed') {
          refresh(true)
        }
      } catch {
        active.close()
      }
    }
    active.onclose = () => {
      if (account !== epoch || socket !== active || disposed) {
        return
      }
      socket = undefined
      clearInterval(heartbeat)
      reconnect = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(failures++, 5)))
    }
    active.onerror = () => active.close()
  }
  const stop = watch([() => identity.user?.id, () => identity.token], () => {
    epoch++
    revision++
    controller?.abort()
    disconnect()
    known.clear()
    Object.assign(notifications, { open: false, ready: false, toast: null, filter: 'all', unread: 0, items: [], nextCursor: null, error: '', loading: false })
    failures = 0
    if (identity.user) {
      void loadNotifications()
      connect()
    }
  }, { immediate: true, flush: 'sync' })
  const foreground = () => {
    if (document.visibilityState === 'visible') {
      refresh()
      connect()
    }
  }
  const offline = () => {
    disconnect()
  }
  const fallback = setInterval(() => {
    if ((!socket || socket.readyState !== WebSocket.OPEN) && document.visibilityState === 'visible') {
      refresh()
      connect()
    }
  }, 30000)
  window.addEventListener('online', foreground)
  window.addEventListener('offline', offline)
  window.addEventListener('focus', foreground)
  document.addEventListener('visibilitychange', foreground)
  return () => {
    disposed = true
    stop()
    epoch++
    revision++
    controller?.abort()
    disconnect()
    clearInterval(fallback)
    window.removeEventListener('online', foreground)
    window.removeEventListener('offline', offline)
    window.removeEventListener('focus', foreground)
    document.removeEventListener('visibilitychange', foreground)
  }
}
