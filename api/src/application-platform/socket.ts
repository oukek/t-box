import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ApiError } from '@t-box/server-foundation/errors'
import '@fastify/websocket'

export function registerApplicationCatalogSocket(scope: FastifyInstance, platform: PlatformService, allowed: Set<string>) {
  const monitor = platform.applicationCatalogUpdates
  const timer = setInterval(() => {
    void monitor.tick().catch(() => scope.log.warn({ code: 'CATALOG_SYNC_FAILED' }, 'Application catalog sync will retry'))
  }, 3000)
  timer.unref()
  scope.addHook('onClose', async () => {
    clearInterval(timer)
    await monitor.tick().catch(() => {})
  })
  scope.get('/api/v1/app-market/ws', { websocket: true, preValidation: async (req) => {
    if (!req.headers.origin || !allowed.has(req.headers.origin)) {
      throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '此网页来源不允许连接')
    }
    if (scope.websocketServer.clients.size >= 200) {
      throw new ApiError(429, 'CONNECTION_LIMIT', '连接数量已达上限')
    }
  } }, (socket) => {
    let authenticated = false
    let busy = false
    let unsubscribe: (() => void) | undefined
    let alive = true
    let count = 0
    let windowStart = Date.now()
    const handshake = setTimeout(() => socket.close(1008, 'Authentication required'), 10_000)
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      if (socket.readyState === 1) {
        socket.ping()
      }
    }, 30_000)
    handshake.unref()
    heartbeat.unref()
    socket.on('pong', () => {
      alive = true
    })
    const send = (value: unknown) => {
      if (socket.readyState !== 1) {
        return
      }
      if (socket.bufferedAmount > 100_000) {
        socket.close(1013, 'Client too slow')
        return
      }
      socket.send(JSON.stringify(value))
    }
    socket.on('message', async (raw, binary) => {
      if (Date.now() - windowStart > 10_000) {
        count = 0
        windowStart = Date.now()
      }
      if (binary || ++count > 20 || busy) {
        socket.close(1008, 'Invalid event')
        return
      }
      busy = true
      try {
        const event = JSON.parse(raw.toString())
        if (!authenticated && event?.type === 'authenticate' && typeof event.token === 'string') {
          const actor = await platform.identity.authenticate(event.token)
          if (socket.readyState !== 1) {
            return
          }
          authenticated = true
          clearTimeout(handshake)
          unsubscribe = monitor.subscribe(actor, (revision) => send({ type: 'catalog.changed', revision }), () => socket.close(1008, 'Session expired'))
          send({ type: 'ready' })
          await monitor.tick()
        } else if (authenticated && event?.type === 'ping') {
          send({ type: 'pong' })
        } else {
          socket.close(1008, 'Invalid event')
        }
      } catch {
        socket.close(authenticated ? 1011 : 1008, 'Catalog connection unavailable')
      } finally {
        busy = false
      }
    })
    const close = () => {
      clearTimeout(handshake)
      clearInterval(heartbeat)
      unsubscribe?.()
    }
    socket.once('close', close)
    socket.once('error', close)
  })
}
