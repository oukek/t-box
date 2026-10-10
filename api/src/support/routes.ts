import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { bearer } from '../identity/service.js'

export function registerCustomerSupport(
  app: FastifyInstance,
  platform: PlatformService,
) {
  app.get('/api/v1/support', async (request, reply) => {
    await platform.identity.authenticate(bearer(request.headers.authorization))
    reply.header('Cache-Control', 'no-store')
    return { data: await platform.support.publicConfiguration() }
  })
}
