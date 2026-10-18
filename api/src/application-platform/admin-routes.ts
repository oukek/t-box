import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ApplicationPublishing } from './publishing.js'
import { validId } from '@t-box/app-contracts'
import { ErrorCode } from '../error-codes.js'

export function registerApplicationPublishing(
  app: FastifyInstance,
  service: ApplicationPublishing,
  actor: (request: FastifyRequest) => Promise<{ id: string }>,
) {
  const appId = (id: string) => {
    if (!validId(id)) {
      throw ErrorCode.INVALID_APP_ID()
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
    async (r) => ({ data: await service.artifactList(appId(r.params.id)) }),
  )
  app.patch<{ Params: { id: string } }>(
    '/application-releases/:id/metadata',
    async (r) => ({
      data: await service.updateMetadata(
        r.params.id,
        r.body,
        (await actor(r)).id,
      ),
    }),
  )
  app.post<{ Params: { id: string } }>(
    '/applications/:id/artifacts',
    { bodyLimit: 30 * 1024 * 1024 },
    async (r, reply) => {
      await actor(r)
      if (service.delivery === 'oss') {
        throw ErrorCode.APP_USE_OSS_WORKFLOW()
      }
      return reply.code(201).send({
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
