import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import { NativeActionSessions } from '../identity/native-sessions.js'
import { bearer } from '../identity/service.js'

/** The n1 prefix is intentionally rejected by ordinary identity/API authentication. */
export function registerNativeActions(app: FastifyInstance, platform: PlatformService) {
  const sessions = new NativeActionSessions(platform.identity)
  app.post('/api/v1/native/session', async (request, reply) => {
    const result = await sessions.issue(bearer(request.headers.authorization), request.body)
    reply.header('Cache-Control', 'no-store')
    return { data: result }
  })
  app.delete('/api/v1/native/session', async (request, reply) => {
    const token = bearer(request.headers.authorization)
    await sessions.revoke(token)
    return reply.code(204).send()
  })
  app.get('/api/v1/native/actions', async (request, reply) => {
    const actor = await platform.identity.authenticate(bearer(request.headers.authorization))
    reply.header('Cache-Control', 'no-store')
    return { data: await platform.applications.actions(actor.user.id) }
  })
  app.post<{ Params: { appId: string, actionId: string } }>('/api/v1/native/actions/:appId/:actionId', { bodyLimit: 65536 }, async (request, reply) => {
    const token = bearer(request.headers.authorization)
    const actor = await sessions.authenticate(token)
    const input = request.body as { releaseId?: unknown, generation?: unknown, actionVersion?: unknown, arguments?: unknown } | null
    const key = request.headers['idempotency-key']
    if (!input || Object.keys(input).some((field) => !['releaseId', 'generation', 'actionVersion', 'arguments'].includes(field)) || typeof input.releaseId !== 'string' || !Number.isSafeInteger(input.generation) || typeof key !== 'string' || !/^[\w-]{1,80}$/.test(key)) {
      throw ErrorCode.NATIVE_ACTION_INVALID()
    }
    const action = (await platform.applications.actions(actor.user.id)).find((item) => item.appId === request.params.appId && item.id === request.params.actionId)
    if (!action || !action.background || action.version !== input.actionVersion || action.releaseId !== input.releaseId || action.generation !== input.generation) {
      throw ErrorCode.NATIVE_ACTION_UNAVAILABLE()
    }
    reply.header('Cache-Control', 'no-store')
    const result = await platform.applications.invoke(actor.user.id, action.appId, action.releaseId, action.generation, action.id, input.arguments, key)
    return { data: result === undefined ? null : result }
  })
}
