import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { bearer } from '../identity/service.js'
import { ApplicationFiles } from './application-files.js'
import { MAX_RESOURCE_SIZE } from './service.js'

export function registerApplicationFiles(
  app: FastifyInstance,
  platform: PlatformService,
) {
  const files = new ApplicationFiles(platform.applications, platform.resources)
  app.register(async (scope) => {
    scope.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: MAX_RESOURCE_SIZE },
      (_request, body, done) => done(null, body),
    )
    scope.post<{ Params: { id: string } }>(
      '/api/v1/applications/:id/files',
      {
        bodyLimit: MAX_RESOURCE_SIZE,
        onRequest: async (request) => {
          await platform.identity.authenticate(
            bearer(request.headers.authorization),
          )
        },
      },
      async (request, reply) => {
        const actor = await platform.identity.authenticate(
          bearer(request.headers.authorization),
        )
        if (!Buffer.isBuffer(request.body)) {
          throw new ApiError(415, 'INVALID_UPLOAD', '请使用二进制文件上传')
        }
        let name = '未命名文件'
        try {
          name = decodeURIComponent(
            String(request.headers['x-file-name'] || name),
          )
        } catch {}
        const file = await files.upload(
          actor,
          request.params.id,
          name,
          request.body as Buffer,
        )
        return reply.code(201).send({ data: file })
      },
    )
    scope.get<{ Params: { id: string, resourceId: string } }>(
      '/api/v1/applications/:id/files/:resourceId',
      async (request, reply) => {
        const actor = await platform.identity.authenticate(
          bearer(request.headers.authorization),
        )
        reply.header('Cache-Control', 'private, no-store')
        return {
          data: await files.read(
            actor,
            request.params.id,
            request.params.resourceId,
          ),
        }
      },
    )
  })
}
