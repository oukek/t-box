import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import { bearer } from '../identity/service.js'
import { PromotionPoster } from './poster.js'

export function registerPromotions(app: FastifyInstance, platform: PlatformService) {
  const posters = new PromotionPoster(platform.promotions.creatives)
  app.register(async (scope) => {
    scope.addHook('onRequest', async (_request, reply) => {
      reply.header('Cache-Control', 'no-store').header('X-Content-Type-Options', 'nosniff').header('Referrer-Policy', 'no-referrer')
    })
    scope.post('/me', async (req) => {
      const actor = await platform.identity.authenticate(bearer(req.headers.authorization))
      return { data: await platform.promotions.personal(actor.user.id) }
    })
    scope.post('/js-sdk', async (req) => {
      await platform.identity.authenticate(bearer(req.headers.authorization))
      platform.identity.limit('promotion-sdk:' + req.ip, 60, 60_000)
      return { data: await platform.promotions.jsSdk(req.body) }
    })
    scope.get('/thumbnail.jpg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').type('image/jpeg').send(await posters.thumbnail()))
    scope.get('/defaults/poster.jpg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').type('image/jpeg').send(await posters.defaultTemplate()))
    scope.get('/defaults/thumbnail.jpg', async (_req, reply) => reply.header('Cache-Control', 'public, max-age=3600').type('image/jpeg').send(await posters.defaultThumbnail()))
    scope.get<{ Params: { id: string } }>('/assets/:id.jpg', async (req, reply) => reply.header('Cache-Control', 'public, max-age=31536000, immutable').type('image/jpeg').send(await platform.promotions.creatives.bytes(req.params.id)))
    scope.get<{ Params: { token: string } }>('/:token/poster.png', async (req, reply) => {
      platform.identity.limit('promotion-poster:' + req.ip, 60, 60_000)
      const source = await platform.promotions.findToken(req.params.token)
      if (!source) {
        throw ErrorCode.PROMOTION_NOT_FOUND()
      }
      const link = await platform.promotions.link(source)
      if ((req.query as { download?: string }).download === '1') {
        reply.header('Content-Disposition', 'attachment; filename="t-ark-poster.png"')
      }
      return reply.type('image/png').send(await posters.render(link.shareUrl))
    })
  }, { prefix: '/api/v1/promotions' })
}
