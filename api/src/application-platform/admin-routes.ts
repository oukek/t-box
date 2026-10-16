import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApplicationPublishing } from './publishing.js'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'

export function registerApplicationPublishing(
  app: FastifyInstance,
  service: ApplicationPublishing,
  actor: (request: FastifyRequest) => Promise<{ id: string }>,
) {
  const appId = (id: string) => {
    if (!validId(id)) {
      throw new ApiError(400, 'INVALID_APP_ID', '应用标识无效')
    }
    return id
  }
  app.get('/applications', async () => ({
    data: {
      applications: await service.list(),
      artifactOrigin: service.origin,
      artifactDelivery: service.delivery,
    },
  }))
  app.get<{ Params: { id: string } }>(
    '/applications/:id/artifacts',
    async (r) => ({ data: await service.artifacts.list(appId(r.params.id)) }),
  )
  app.post<{ Params: { id: string } }>(
    '/applications/:id/artifacts',
    { bodyLimit: 30 * 1024 * 1024 },
    async (r, reply) => {
      await actor(r)
      if (service.delivery === 'oss') {
        throw new ApiError(409, 'APP_USE_OSS_WORKFLOW', '当前使用 OSS 静态发布，请通过应用发布工作流上传，再在后台审核上架')
      }
      return reply
        .code(201)
        .send({
          data: await service.artifacts.upload(appId(r.params.id), r.body),
        })
    },
  )
  app.get<{ Params: { id: string } }>(
    '/applications/:id/events',
    async (r) => ({ data: await service.events(appId(r.params.id)) }),
  )
  app.post('/application-releases', async (r, reply) =>
    reply
      .code(201)
      .send({ data: await service.save(r.body, (await actor(r)).id) }))
  app.patch<{ Params: { id: string } }>(
    '/application-releases/:id',
    async (r) => ({
      data: await service.save(r.body, (await actor(r)).id, r.params.id),
    }),
  )
  app.post<{ Params: { id: string } }>(
    '/application-releases/:id/transitions',
    async (r) => ({
      data: await service.transition(r.params.id, r.body, (await actor(r)).id),
    }),
  )
}
