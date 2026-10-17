import type { FastifyInstance } from 'fastify'
import type { ChatService } from './engine.js'
import { networkInterfaces } from 'node:os'
import websocket from '@fastify/websocket'
import { ApiError } from '@t-box/server-foundation/errors'

export function registerChatSocket(
  app: FastifyInstance,
  service: ChatService,
  origins: string[] = ['*'],
  registerExtensions?: (scope: FastifyInstance, allowed: Set<string>) => void,
) {
  const allowed = new Set([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://10.0.2.2:5173',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
    ...origins,
  ])
  for (const values of Object.values(networkInterfaces())) {
    for (const address of values ?? []) {
      if (address.family === 'IPv4') {
        allowed.add(`http://${address.address}:5173`)
      }
    }
  }
  app.register(websocket, { options: { maxPayload: 16 * 1024 } })
  app.register(async (scope) => {
    registerExtensions?.(scope, allowed)
    scope.get(
      '/api/v1/chat/ws',
      {
        websocket: true,
        preValidation: async (request) => {
          if (!allowed.has('*') && (!request.headers.origin || !allowed.has(request.headers.origin))) {
            throw new ApiError(
              403,
              'ORIGIN_NOT_ALLOWED',
              '此网页来源不允许连接对话服务',
            )
          }
          if (scope.websocketServer.clients.size >= 200) {
            throw new ApiError(429, 'CONNECTION_LIMIT', '连接数量已达上限')
          }
        },
      },
      (socket) => {
        let alive = true
        socket.on('pong', () => {
          alive = true
        })
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
        const connection = service.connect((event) => {
          if (socket.readyState === 1) {
            if (socket.bufferedAmount > 1_000_000) {
              socket.close(1013, 'Client too slow')
              return
            }
            socket.send(JSON.stringify(event))
          }
        })
        let count = 0
        let windowStart = Date.now()
        socket.on('message', (raw, binary) => {
          if (Date.now() - windowStart > 10_000) {
            count = 0
            windowStart = Date.now()
          }
          if (++count > 100) {
            socket.close(1008, 'Message rate exceeded')
            return
          }
          if (binary) {
            socket.close(1003, 'JSON text only')
            return
          }
          try {
            void connection
              .receive(JSON.parse(raw.toString()))
              .catch(() => socket.close(1011, 'Message processing failed'))
          } catch {
            socket.send(
              JSON.stringify({
                type: 'error',
                code: 'INVALID_EVENT',
                message: '消息不是有效的 JSON',
              }),
            )
          }
        })
        socket.once('close', () => {
          clearInterval(heartbeat)
          connection.close()
        })
        socket.once('error', () => {
          clearInterval(heartbeat)
          connection.close()
        })
      },
    )
  })
}
