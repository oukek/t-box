import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { object } from '@t-box/server-foundation/input'
import { parseId } from '@t-box/server-foundation/validation'
import { ErrorCode } from '../error-codes.js'
import { WechatFlowEntity } from '../identity/wechat-entities.js'
import { watchQr } from './qr-signals.js'
import '@fastify/websocket'

/** Proofs/tokens travel in the first frame, never in a URL or access log. */
export function registerQrSocket(scope: FastifyInstance, platform: PlatformService, allowed: Set<string>) {
  scope.get('/api/v1/qr/ws', {
    websocket: true,
    preValidation: async (request) => {
      if (!allowed.has('*') && (!request.headers.origin || !allowed.has(request.headers.origin))) {
        throw ErrorCode.ORIGIN_NOT_ALLOWED()
      }
      if (scope.websocketServer.clients.size >= 200) {
        throw ErrorCode.CONNECTION_LIMIT()
      }
    },
  }, (socket) => {
    let closed = false
    let authenticated = false
    let busy = false
    let queued = false
    let last = ''
    let alive = true
    let read: ((reconcile: boolean) => Promise<unknown>) | undefined
    let unsubscribe: (() => void) | undefined
    let reconcile: ReturnType<typeof setInterval> | undefined
    let expiry: ReturnType<typeof setTimeout> | undefined
    const send = (value: unknown) => {
      if (closed || socket.readyState !== 1) {
        return
      }
      if (socket.bufferedAmount > 100_000) {
        socket.close(1013, 'Client too slow')
        return
      }
      socket.send(JSON.stringify(value))
    }
    const fail = (cause: unknown) => {
      const error = cause as { code?: string, message?: string, statusCode?: number }
      send({ type: 'error', code: error.statusCode ? error.code : 'SOCKET_UNAVAILABLE', message: error.statusCode ? error.message : '状态连接暂时不可用，请重新连接' })
      socket.close(error.statusCode && error.statusCode < 500 ? 1008 : 1011, 'State unavailable')
    }
    const refresh = async (query = false) => {
      if (closed || !read) {
        return
      }
      if (busy) {
        queued = true
        return
      }
      busy = true
      try {
        const event = await read(query)
        const serialized = JSON.stringify(event)
        if (serialized !== last) {
          last = serialized
          send(event)
        }
      } catch (cause) {
        fail(cause)
      } finally {
        busy = false
        if (queued && !closed) {
          queued = false
          void refresh()
        }
      }
    }
    const handshake = setTimeout(() => socket.close(1008, 'Authentication required'), 10_000)
    handshake.unref()
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
    heartbeat.unref()
    socket.on('pong', () => {
      alive = true
    })
    socket.on('message', (raw, binary) => {
      if (authenticated || binary) {
        socket.close(1008, 'One subscription per connection')
        return
      }
      authenticated = true
      void (async () => {
        const input = object(JSON.parse(raw.toString()), ['type', 'id', 'secret', 'token', 'orderId', 'ticket'])
        let key: string
        if (input.type === 'login' && platform.wechatLogin) {
          const proof = { id: input.id, secret: input.secret }
          const initial = await platform.wechatLogin.poll(proof)
          key = `login:${String(input.id)}`
          read = async () => ({ type: 'login.state', data: await platform.wechatLogin!.poll(proof) })
          send({ type: 'login.state', data: initial })
          const flow = await platform.wechatLogin.configuration.source.getRepository(WechatFlowEntity).findOneByOrFail({ id: String(input.id) })
          expiry = setTimeout(() => void refresh(), Math.max(1, flow.expiresAt.getTime() - Date.now() + 10))
          expiry.unref()
        } else if ((input.type === 'payment' || input.type === 'handoff') && platform.checkoutLinks && typeof input.token === 'string') {
          const token = input.token
          const actor = await platform.identity.authenticate(token)
          const orderId = input.type === 'payment' ? parseId(input.orderId) : (await platform.checkoutLinks.handoffState(actor, { ticket: input.ticket })).order.id
          if (input.type === 'payment') {
            await platform.payments.get(actor.user.id, orderId)
          }
          key = `order:${orderId}`
          read = async (query) => {
            const current = await platform.identity.authenticate(token)
            const data = input.type === 'payment'
              ? await platform.checkoutLinks!.state(current.user.id, orderId, query)
              : await platform.checkoutLinks!.handoffState(current, { ticket: input.ticket }, query)
            return { type: 'payment.state', data }
          }
          // Trusted channel reconciliation and cross-process recovery stay server-side.
          reconcile = setInterval(() => void refresh(true), 5000)
          reconcile.unref()
        } else {
          throw ErrorCode.AUTH_REQUIRED()
        }
        if (closed) {
          close()
          return
        }
        clearTimeout(handshake)
        unsubscribe = watchQr(platform.payments.source, key, () => void refresh())
        await refresh()
      })().catch(fail)
    })
    function close() {
      closed = true
      clearTimeout(handshake)
      clearTimeout(expiry)
      clearInterval(heartbeat)
      clearInterval(reconcile)
      unsubscribe?.()
    }
    socket.once('close', close)
    socket.once('error', close)
  })
}
