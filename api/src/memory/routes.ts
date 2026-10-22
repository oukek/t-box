import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { parseId } from '@t-box/server-foundation/validation'
import { ErrorCode } from '../error-codes.js'
import { bearer } from '../identity/service.js'

export function registerMemory(
  app: FastifyInstance,
  platform: PlatformService,
) {
  const actor = (request: FastifyRequest) =>
    platform.identity.authenticate(bearer(request.headers.authorization))
  app.register(
    async (scope) => {
      scope.addHook('onRequest', async (_request, reply) => {
        reply.header('Cache-Control', 'no-store')
      })
      scope.get('/', async (request) => ({
        data: await platform.memory.list(await actor(request)),
      }))
      scope.patch('/settings', async (request) => ({
        data: await platform.memory.settings(
          await actor(request),
          request.body,
        ),
      }))
      scope.post('/', async (request, reply) =>
        reply.code(201).send({
          data: await platform.memory.save(await actor(request), request.body),
        }))
      scope.patch<{ Params: { id: string } }>('/:id', async (request) => ({
        data: await platform.memory.save(
          await actor(request),
          request.body,
          parseId(request.params.id),
        ),
      }))
      scope.post<{ Params: { id: string } }>(
        '/:id/accept',
        async (request, reply) => {
          const input = request.body as { version?: unknown } | undefined
          if (!input || !Number.isSafeInteger(input.version)) {
            throw ErrorCode.MEMORY_INVALID()
          }
          await platform.memory.accept(
            await actor(request),
            parseId(request.params.id),
            input.version as number,
          )
          return reply.code(204).send()
        },
      )
      scope.delete<{ Params: { id: string } }>(
        '/:id',
        async (request, reply) => {
          await platform.memory.forget(
            await actor(request),
            request.params.id === 'all' ? 'all' : parseId(request.params.id),
          )
          return reply.code(204).send()
        },
      )
    },
    { prefix: '/api/v1/ai/memories' },
  )
}
