import type { FastifyInstance } from 'fastify'
import type { Actor } from '../application-sdk/contracts.js'
import type { ApplicationPlatform } from './service.js'
import { validId } from '@t-box/app-contracts'
import { ErrorCode } from '../error-codes.js'
import { bearer } from '../identity/service.js'

export function registerApplicationPlatform(
  app: FastifyInstance,
  service: ApplicationPlatform,
  authenticate: (token: string) => Promise<Actor>,
) {
  const actor = async (authorization: string | undefined) =>
    authenticate(bearer(authorization))
  app.get('/api/v1/app-market', async (req, reply) => {
    const a = await actor(req.headers.authorization)
    reply.header('Cache-Control', 'no-store')
    return { data: await service.catalog(a.user.id) }
  })
  app.post<{ Params: { id: string } }>(
    '/api/v1/app-market/:id/repair',
    async (req) => {
      const a = await actor(req.headers.authorization)
      if (!validId(req.params.id)) {
        throw ErrorCode.INVALID_APP_ID()
      }
      return { data: await service.repair(a.user.id, req.params.id) }
    },
  )
  app.post<{
    Params: { id: string }
    Body: {
      action: string
      releaseId: string
      grants: string[]
      hostVersion?: string
    }
  }>('/api/v1/app-market/:id/operations', async (req, reply) => {
    const a = await actor(req.headers.authorization)
    const b = req.body
    if (
      !validId(req.params.id) ||
      !b ||
      Object.keys(b).some(
        (k) => !['action', 'releaseId', 'grants', 'hostVersion'].includes(k),
      ) ||
      !['install', 'update', 'uninstall'].includes(b.action) ||
      typeof b.releaseId !== 'string' ||
      !Array.isArray(b.grants) ||
      b.grants.some((g) => typeof g !== 'string')
    ) {
      throw ErrorCode.INVALID_APP_OPERATION()
    }
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string') {
      throw ErrorCode.REQUEST_KEY_REQUIRED()
    }
    if (b.action !== 'uninstall') {
      const release = await service.release(b.releaseId)
      if (
        release.runtime.type === 'shell' &&
        b.hostVersion !== release.manifest.version
      ) {
        throw ErrorCode.HOST_UPDATE_REQUIRED()
      }
    }
    reply.header('Cache-Control', 'no-store')
    return {
      data: await service.change(
        a.user.id,
        req.params.id,
        b.action as 'install' | 'update' | 'uninstall',
        b.releaseId,
        key,
        b.grants,
      ),
    }
  })
  app.get<{ Params: { id: string } }>(
    '/api/v1/app-market/operations/:id',
    async (req, reply) => {
      const a = await actor(req.headers.authorization)
      reply.header('Cache-Control', 'no-store')
      return { data: await service.operation(a.user.id, req.params.id) }
    },
  )
  app.get<{ Params: { id: string }, Querystring: { platform: string } }>(
    '/api/v1/applications/:id/context',
    async (req, reply) => {
      const a = await actor(req.headers.authorization)
      if (
        !validId(req.params.id) ||
        !['web', 'android', 'ios'].includes(req.query.platform)
      ) {
        throw ErrorCode.INVALID_PLATFORM()
      }
      reply.header('Cache-Control', 'no-store')
      return {
        data: await service.context(
          a.user.id,
          req.params.id,
          req.query.platform as 'web' | 'android' | 'ios',
        ),
      }
    },
  )
  app.get<{ Params: { id: string }, Querystring: { platform: string } }>(
    '/api/v1/applications/:id/runtime',
    async (req, reply) => {
      const a = await actor(req.headers.authorization)
      if (!['web', 'android', 'ios'].includes(req.query.platform)) {
        throw ErrorCode.INVALID_PLATFORM('运行平台无效')
      }
      reply.header('Cache-Control', 'no-store')
      return {
        data: await service.runtime(
          a.user.id,
          req.params.id,
          req.query.platform as 'web' | 'android' | 'ios',
        ),
      }
    },
  )
  app.post<{
    Params: { id: string }
    Body: {
      releaseId: string
      generation: number
      method: string
      arguments: unknown
    }
  }>('/api/v1/applications/:id/invoke', async (req, reply) => {
    const a = await actor(req.headers.authorization)
    const b = req.body
    if (
      !b ||
      Object.keys(b).some(
        (k) => !['releaseId', 'generation', 'method', 'arguments'].includes(k),
      ) ||
      typeof b.releaseId !== 'string' ||
      !Number.isSafeInteger(b.generation) ||
      !validId(b.method)
    ) {
      throw ErrorCode.INVALID_APP_INVOCATION()
    }
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[\w-]{1,80}$/.test(key)) {
      throw ErrorCode.REQUEST_KEY_REQUIRED('调用标识无效')
    }
    reply.header('Cache-Control', 'no-store')
    return {
      data: await service.invoke(
        a.user.id,
        req.params.id,
        b.releaseId,
        b.generation,
        b.method,
        b.arguments,
        key,
      ),
    }
  })
  app.post<{ Params: { id: string } }>(
    '/api/v1/applications/:id/events',
    async (req, reply) => {
      const a = await actor(req.headers.authorization)
      const input = req.body as {
        releaseId: string
        generation: number
        channel: string
        cursor?: string
        arguments?: unknown
      }
      if (
        !validId(req.params.id) ||
        !input ||
        Object.keys(input).some(
          (key) =>
            ![
              'releaseId',
              'generation',
              'channel',
              'cursor',
              'arguments',
            ].includes(key),
        ) ||
        typeof input.releaseId !== 'string' ||
        !Number.isSafeInteger(input.generation) ||
        typeof input.channel !== 'string' ||
        !/^[a-z][a-z0-9_.-]{0,63}$/.test(input.channel) ||
        (input.cursor !== undefined &&
          (typeof input.cursor !== 'string' || input.cursor.length > 4096))
      ) {
        throw ErrorCode.INVALID_APP_EVENT()
      }
      reply.header('Cache-Control', 'no-store')
      return { data: await service.events(a.user.id, req.params.id, input) }
    },
  )
}
