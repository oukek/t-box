import type { FastifyInstance } from 'fastify'
import type { Actor } from '../application-sdk/contracts.js'
import type { ApplicationPlatform } from './service.js'
import { validId } from '@t-box/app-contracts'
import { ApiError } from '@t-box/server-foundation/errors'
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
  app.post<{ Params: { id: string } }>('/api/v1/app-market/:id/repair', async (req) => {
    const a = await actor(req.headers.authorization)
    if (!validId(req.params.id)) {
      throw new ApiError(400, 'INVALID_APP_ID', '应用标识无效')
    }
    return { data: await service.repair(a.user.id, req.params.id) }
  })
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
      throw new ApiError(400, 'INVALID_APP_OPERATION', '应用操作参数无效')
    }
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string') {
      throw new ApiError(400, 'REQUEST_KEY_REQUIRED', '请提供操作标识')
    }
    if (b.action !== 'uninstall') {
      const release = await service.release(b.releaseId)
      if (
        release.runtime.type === 'shell' &&
        b.hostVersion !== release.manifest.version
      ) {
        throw new ApiError(
          409,
          'HOST_UPDATE_REQUIRED',
          '此版本需要先更新宿主应用或刷新网页，再更新应用',
        )
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
        throw new ApiError(400, 'INVALID_PLATFORM', '应用或运行平台无效')
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
        throw new ApiError(400, 'INVALID_PLATFORM', '运行平台无效')
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
      throw new ApiError(400, 'INVALID_APP_INVOCATION', '应用调用参数无效')
    }
    const key = req.headers['idempotency-key']
    if (typeof key !== 'string' || !/^[\w-]{1,80}$/.test(key)) {
      throw new ApiError(400, 'REQUEST_KEY_REQUIRED', '调用标识无效')
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
}
