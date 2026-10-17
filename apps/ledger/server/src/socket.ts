import type { FastifyInstance } from 'fastify'
import type { Principal } from './ledgers/types.js'
import type { LedgerRuntimeServices } from './ports.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { parseId } from './validation.js'
import '@fastify/websocket'

export function registerLedgerSocket(
  scope: FastifyInstance,
  p: LedgerRuntimeServices,
  allowed: Set<string>,
) {
  scope.get(
    '/api/v1/ledgers/ws',
    {
      websocket: true,
      preValidation: async (req) => {
        if (!allowed.has('*') && (!req.headers.origin || !allowed.has(req.headers.origin))) {
          throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', '此网页来源不允许连接')
        }
        if (scope.websocketServer.clients.size >= 200) {
          throw new ApiError(429, 'CONNECTION_LIMIT', '连接数已满')
        }
      },
    },
    (socket) => {
      let principal: Principal | undefined
      let bookId: string | undefined
      let busy = false
      let count = 0
      let windowStart = Date.now()
      const send = (event: unknown) => {
        if (socket.readyState === 1) {
          if (socket.bufferedAmount > 100_000) {
            socket.close(1013)
            return
          }
          socket.send(JSON.stringify(event))
        }
      }
      const refresh = async (id?: string) => {
        if (!principal || !bookId || (id && id !== bookId)) {
          return
        }
        try {
          await p.applications?.assertActive(principal.user.id, 'ledger')
          const access = await p.access.check(principal, bookId)
          send({
            type: 'ledger.changed',
            ledgerId: bookId,
            revision: Number(access.book.revision),
          })
        } catch (error) {
          const code = error instanceof ApiError ? error.code : 'UNAVAILABLE'
          send({ type: 'ledger.revoked', ledgerId: bookId, code })
          bookId = undefined
          if (code === 'UNAUTHENTICATED') {
            socket.close(1008)
          }
        }
      }
      const listener = (id: string) => {
        void refresh(id)
      }
      p.access.listeners.add(listener)
      const handshake = setTimeout(() => {
        if (!principal) {
          socket.close(1008)
        }
      }, 10_000)
      handshake.unref()
      const heartbeat = setInterval(() => {
        if (socket.readyState === 1) {
          socket.ping()
        }
        if (principal) {
          void p.identity
            .authenticateHash(principal.sessionHash)
            .catch(() => socket.close(1008))
        }
        if (bookId) {
          void (async () => {
            await p.applications?.assertActive(principal!.user.id, 'ledger')
            await p.access.check(principal!, bookId!)
          })().catch(() => refresh())
        }
      }, 30_000)
      heartbeat.unref()
      socket.on('message', async (raw) => {
        if (Date.now() - windowStart > 10_000) {
          count = 0
          windowStart = Date.now()
        }
        if (++count > 30 || busy) {
          socket.close(1008)
          return
        }
        busy = true
        try {
          const event = JSON.parse(raw.toString())
          if (event.type === 'authenticate' && !principal) {
            principal = await p.identity.authenticate(
              typeof event.token === 'string' ? event.token : '',
            )
            await p.applications?.assertActive(principal.user.id, 'ledger')
            clearTimeout(handshake)
            send({ type: 'ready' })
          } else if (event.type === 'subscribe' && principal) {
            await p.applications?.assertActive(principal.user.id, 'ledger')
            const id = parseId(event.ledgerId)
            await p.access.check(principal, id)
            bookId = id
            await refresh()
          } else {
            throw new ApiError(400, 'INVALID_EVENT', '事件无效')
          }
        } catch (error) {
          send({
            type: 'error',
            code: error instanceof ApiError ? error.code : 'INVALID_EVENT',
          })
          if (!principal) {
            socket.close(1008)
          }
        } finally {
          busy = false
        }
      })
      const close = () => {
        clearTimeout(handshake)
        clearInterval(heartbeat)
        p.access.listeners.delete(listener)
      }
      socket.once('close', close)
      socket.once('error', close)
    },
  )
}
