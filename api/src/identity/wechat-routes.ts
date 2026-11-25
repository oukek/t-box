import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import { deviceLabel } from './security.js'
import { bearer } from './service.js'
import { collectorDevice } from './wechat-login.js'

export function registerWechatLogin(app: FastifyInstance, platform: PlatformService) {
  const service = () => {
    if (!platform.wechatLogin) {
      throw ErrorCode.WECHAT_LOGIN_DISABLED()
    }
    return platform.wechatLogin
  }
  app.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer')
    })
    scope.get('/configuration', async () => ({ data: { enabled: (await service().configuration.view()).enabled } }))
    scope.post('/start', async (request) => ({ data: await service().start(request.body, request.ip, deviceLabel(request.headers['user-agent'])) }))
    scope.post('/collector/start', async (request) => {
      const body = request.body as { secret?: unknown } | null
      return { data: await service().start({ kind: 'qr', secret: body?.secret }, request.ip, collectorDevice) }
    })
    scope.post('/collector/approve', async (request, reply) => {
      await service().approveCollector(request.body, bearer(request.headers.authorization))
      return reply.code(204).send()
    })
    scope.post('/collector/redeem', async (request) => ({ data: await service().redeemCollector(request.body) }))
    scope.post('/exchange', async (request) => ({ data: await service().exchange(request.body) }))
    scope.post('/authorize-profile', async (request) => ({ data: await service().authorizeProfile(request.body) }))
    scope.post('/poll', async (request) => ({ data: await service().poll(request.body) }))
    scope.post('/confirm', async (request) => ({ data: await service().confirm(request.body) }))
    scope.post('/cancel', async (request, reply) => {
      await service().cancel(request.body)
      return reply.code(204).send()
    })
  }, { prefix: '/api/v1/auth/wechat' })
}
