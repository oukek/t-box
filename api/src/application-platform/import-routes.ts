import type { FastifyInstance } from 'fastify'
import type { ApplicationBuildImports } from './build-import.js'

export function registerApplicationBuildImports(app: FastifyInstance, service: ApplicationBuildImports) {
  app.post('/api/v1/application-builds', {
    onRequest: async (r) => {
      await service.authenticate(r.headers.authorization)
    },
  }, async (r, reply) => {
    const actor = await service.authenticate(r.headers.authorization)
    const data = await service.submit(r.body, actor)
    return reply.code(201).header('Cache-Control', 'no-store').send({ data })
  })
}
