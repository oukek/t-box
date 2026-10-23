import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import '@fastify/websocket'

/** Push local commits immediately; DB revisions also detect worker/other-process commits. */
export function registerQuotaSocket(
  scope: FastifyInstance,
  platform: PlatformService,
  allowed: Set<string>,
) {
  scope.get(
    '/api/v1/wallet/ws',
    {
      websocket: true,
      preValidation: async (req) => {
        if (
          !allowed.has('*') &&
          (!req.headers.origin || !allowed.has(req.headers.origin))
        ) {
          throw ErrorCode.ORIGIN_NOT_ALLOWED()
        }
        if (scope.websocketServer.clients.size >= 200) {
          throw ErrorCode.CONNECTION_LIMIT()
        }
      },
    },
    (socket) => {
      let userId = ''
      let token = ''
      let revision = -1
      let busy = false
      let closed = false
      let unsubscribe: (() => void) | undefined
      const handshake = setTimeout(
        () => socket.close(1008, 'Authentication required'),
        10000,
      )
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
      const refresh = async () => {
        if (!userId || busy || closed) {
          return
        }
        busy = true
        try {
          await platform.identity.authenticate(token)
          const wallet = await platform.billing.wallet(userId)
          if (wallet.revision !== revision) {
            revision = wallet.revision
            send({ type: 'quota.changed', revision })
          }
        } catch {
          socket.close(1008, 'Session unavailable')
        } finally {
          busy = false
        }
      }
      const timer = setInterval(() => {
        void refresh()
      }, 5000)
      timer.unref()
      handshake.unref()
      socket.on('message', (raw, binary) => {
        if (userId || binary || busy) {
          socket.close(1008, 'Invalid event')
          return
        }
        busy = true
        void (async () => {
          try {
            const value: unknown = JSON.parse(raw.toString())
            if (
              !value ||
              typeof value !== 'object' ||
              !('token' in value) ||
              typeof value.token !== 'string' ||
              !('type' in value) ||
              value.type !== 'authenticate'
            ) {
              throw ErrorCode.AUTH_REQUIRED()
            }
            token = value.token
            userId = (await platform.identity.authenticate(token)).user.id
            if (closed) {
              return
            }
            clearTimeout(handshake)
            unsubscribe = platform.billing.onChange((id) => {
              if (id === userId) {
                send({ type: 'quota.changed' })
              }
            })
            send({ type: 'ready' })
          } catch {
            socket.close(1008, 'Authentication failed')
          } finally {
            busy = false
          }
        })()
      })
      const close = () => {
        closed = true
        clearTimeout(handshake)
        clearInterval(timer)
        unsubscribe?.()
      }
      socket.once('close', close)
      socket.once('error', close)
    },
  )
}
