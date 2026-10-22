import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ErrorCode } from '../error-codes.js'
import { bearer } from '../identity/service.js'
import { MAX_RESOURCE_SIZE } from './service.js'

export function registerPrivateApplicationFiles(
  app: FastifyInstance,
  platform: PlatformService,
) {
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: MAX_RESOURCE_SIZE },
      (_req, body, done) => done(null, body),
    )
    scope.post<{ Params: { id: string } }>(
      '/api/v1/applications/:id/private-files',
      {
        bodyLimit: MAX_RESOURCE_SIZE,
        onRequest: async (req) => {
          await platform.identity.authenticate(
            bearer(req.headers.authorization),
          )
        },
      },
      async (req, reply) => {
        const actor = await platform.identity.authenticate(
          bearer(req.headers.authorization),
        )
        if (!Buffer.isBuffer(req.body)) {
          throw ErrorCode.INVALID_UPLOAD()
        }
        let name: string
        let resource: unknown
        try {
          name = decodeURIComponent(
            String(req.headers['x-file-name'] || '未命名文件'),
          )
          resource = JSON.parse(
            decodeURIComponent(String(req.headers['x-file-scope'] || '')),
          )
        } catch {
          throw ErrorCode.PRIVATE_MEDIA_SCOPE_INVALID()
        }
        reply.header('Cache-Control', 'private, no-store')
        return reply
          .code(201)
          .send({
            data: await platform.privateFiles.upload(
              actor,
              req.params.id,
              resource,
              name,
              req.body,
            ),
          })
      },
    )
    scope.get<{
      Params: { id: string, resourceId: string }
      Querystring: { original?: string }
    }>(
      '/api/v1/applications/:id/private-files/:resourceId',
      async (req, reply) => {
        const actor = await platform.identity.authenticate(
          bearer(req.headers.authorization),
        )
        if (
          !/^[a-f0-9-]{36}$/i.test(req.params.resourceId) ||
          !['0', '1'].includes(req.query.original || '0')
        ) {
          throw ErrorCode.PRIVATE_MEDIA_SCOPE_INVALID()
        }
        reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
        return {
          data: await platform.privateFiles.read(
            actor,
            req.params.id,
            req.params.resourceId,
            req.query.original === '1',
          ),
        }
      },
    )
  })
}
