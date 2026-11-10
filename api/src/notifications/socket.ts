import type { Actor } from '@t-box/app-server-sdk'
import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import '@fastify/websocket'

/** Only invalidation hints cross the socket; protected content stays behind authenticated HTTP APIs. */
export function registerNotificationSocket(scope: FastifyInstance, platform: PlatformService, allowed: Set<string>) {
  const subscribers = new Set<{ actor: Actor, revision?: string, changed(revision: string): void, revoked(): void }>()
  let pending: Promise<void> | undefined
  const scan = async () => {
    if (!subscribers.size) {
      return
    }
    for (const entry of [...subscribers]) {
      try {
        await platform.identity.authenticateHash(entry.actor.sessionHash)
      } catch {
        subscribers.delete(entry)
        entry.revoked()
      }
    }
    await platform.notifications.recover()
    const users = [...new Map([...subscribers].map((entry) => [entry.actor.user.id, entry.actor])).values()]
    const revisions = new Map<string, string>()
    await Promise.all(users.map(async (actor) => {
      await platform.notifications.syncReminders(actor.user.id).catch(() => scope.log.warn({ code: 'NOTIFICATION_REMINDERS_FAILED' }, 'Reminder collection will retry'))
      revisions.set(actor.user.id, await platform.notifications.revision(actor))
    }))
    for (const entry of [...subscribers]) {
      const revision = revisions.get(entry.actor.user.id)!
      if (subscribers.has(entry) && revision !== entry.revision) {
        entry.revision = revision
        entry.changed(revision)
      }
    }
  }
  const tick = () => {
    pending ??= scan().finally(() => {
      pending = undefined
    })
    return pending
  }
  const timer = setInterval(() => {
    void tick().catch(() => scope.log.warn({ code: 'NOTIFICATION_SYNC_FAILED' }, 'Notification sync will retry'))
  }, 5000)
  timer.unref()
  scope.addHook('onClose', async () => {
    clearInterval(timer)
    subscribers.clear()
    await pending?.catch(() => {})
  })
  scope.get('/api/v1/notifications/ws', {
    websocket: true,
    preValidation: async (req) => {
      if (!allowed.has('*') && (!req.headers.origin || !allowed.has(req.headers.origin))) {
        throw ErrorCode.ORIGIN_NOT_ALLOWED()
      }
      if (scope.websocketServer.clients.size >= 200) {
        throw ErrorCode.CONNECTION_LIMIT()
      }
    },
  }, (socket) => {
    let subscriber: (typeof subscribers extends Set<infer T> ? T : never) | undefined
    let busy = false
    let count = 0
    let windowStart = Date.now()
    const send = (value: unknown) => {
      if (socket.readyState !== 1) {
        return
      }
      if (socket.bufferedAmount > 100000) {
        socket.close(1013, 'Client too slow')
        return
      }
      socket.send(JSON.stringify(value))
    }
    const timeout = setTimeout(() => socket.close(1008, 'Authentication required'), 10000)
    timeout.unref()
    let alive = true
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate()
        return
      }
      alive = false
      if (socket.readyState === 1) {
        socket.ping()
      }
    }, 30000)
    heartbeat.unref()
    socket.on('pong', () => {
      alive = true
    })
    socket.on('message', async (raw, binary) => {
      if (Date.now() - windowStart > 10000) {
        count = 0
        windowStart = Date.now()
      }
      if (binary || Buffer.byteLength(raw.toString()) > 8192 || ++count > 20 || busy) {
        socket.close(1008, 'Invalid event')
        return
      }
      busy = true
      try {
        const event = JSON.parse(raw.toString())
        if (!subscriber && event?.type === 'authenticate' && typeof event.token === 'string') {
          const actor = await platform.identity.authenticate(event.token)
          if (socket.readyState !== 1) {
            return
          }
          subscriber = { actor, changed: (revision) => send({ type: 'notifications.changed', revision }), revoked: () => socket.close(1008, 'Session expired') }
          subscribers.add(subscriber)
          clearTimeout(timeout)
          send({ type: 'ready' })
          await tick()
        } else if (subscriber && event?.type === 'ping') {
          send({ type: 'pong' })
        } else {
          socket.close(1008, 'Invalid event')
        }
      } catch {
        socket.close(1011, 'Notifications unavailable')
      } finally {
        busy = false
      }
    })
    const close = () => {
      clearTimeout(timeout)
      clearInterval(heartbeat)
      if (subscriber) {
        subscribers.delete(subscriber)
      }
    }
    socket.once('close', close)
    socket.once('error', close)
  })
}
