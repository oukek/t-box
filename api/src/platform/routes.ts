import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PlatformService } from './service.js'
import { registerLedger } from '@t-box/ledger-server'
import { ErrorCode } from '../error-codes.js'
import { bearer } from '../identity/service.js'
import { registerWechatLogin } from '../identity/wechat-routes.js'
import { registerPromotions } from '../promotions/routes.js'

export function registerPlatform(app: FastifyInstance, p: PlatformService) {
  const principal = (req: FastifyRequest) =>
    p.identity.authenticate(bearer(req.headers.authorization))
  app.get('/api/v1/notifications', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.notifications.list(await principal(req)) }
  })
  app.patch('/api/v1/notifications/read', async (req, reply) => {
    await p.notifications.read(await principal(req))
    return reply.code(204).send()
  })
  app.patch<{ Params: { id: string } }>('/api/v1/notifications/:id/read', async (req, reply) => {
    await p.notifications.read(await principal(req), req.params.id)
    return reply.code(204).send()
  })
  registerWechatLogin(app, p)
  registerPromotions(app, p)
  app.get('/api/v1/auth/me', async (req) => ({
    data: (await principal(req)).user,
  }))
  app.patch('/api/v1/auth/me', async (req) => ({
    data: await p.identity.updateProfile(await principal(req), req.body),
  }))
  app.register(async (scope) => {
    scope.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 2 * 1024 * 1024 }, (_request, body, done) => done(null, body))
    scope.post('/api/v1/auth/avatar', { bodyLimit: 2 * 1024 * 1024, onRequest: async (req) => {
      await principal(req)
    } }, async (req) => {
      if (!Buffer.isBuffer(req.body)) {
        throw ErrorCode.PROFILE_AVATAR_INVALID()
      }
      return { data: await p.avatars.upload(await principal(req), req.body) }
    })
  })
  app.delete('/api/v1/auth/avatar', async (req) => ({ data: await p.avatars.reset(await principal(req)) }))
  app.get<{ Params: { id: string } }>('/api/v1/users/:id/avatar', async (req, reply) => {
    return reply.header('Cache-Control', 'public, max-age=300').header('X-Content-Type-Options', 'nosniff').type('image/webp').send(await p.avatars.read(req.params.id))
  })
  app.delete('/api/v1/auth/session', async (req, reply) => {
    await p.identity.logout(await principal(req))
    return reply.code(204).send()
  })
  app.get('/api/v1/auth/sessions', async (req, reply) => {
    reply.header('Cache-Control', 'no-store')
    return { data: await p.accountSecurity.sessions(await principal(req)) }
  })
  app.delete<{ Params: { id: string } }>('/api/v1/auth/sessions/:id', async (req) => ({ data: await p.accountSecurity.revoke(await principal(req), req.params.id) }))
  app.delete('/api/v1/auth/sessions', async (req, reply) => {
    await p.accountSecurity.revokeOthers(await principal(req))
    return reply.code(204).send()
  })
  registerLedger(app, p)
}
