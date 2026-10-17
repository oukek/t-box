import type { FastifyInstance } from 'fastify'
import type { PlatformService } from '../platform/service.js'
import { parseId } from '@t-box/server-foundation/validation'
import { bearer } from '../identity/service.js'
import { MAX_RESOURCE_SIZE } from './service.js'

export function registerResources(app: FastifyInstance, p: PlatformService) {
  app.register(async (routes) => {
    routes.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: MAX_RESOURCE_SIZE },
      (_req, body, done) => done(null, body),
    )
    routes.post(
      '/api/v1/resources',
      {
        bodyLimit: MAX_RESOURCE_SIZE,
        onRequest: async (req) => {
          await p.identity.authenticate(bearer(req.headers.authorization))
        },
      },
      async (req, reply) => {
        const principal = await p.identity.authenticate(
          bearer(req.headers.authorization),
        )
        let name = '未命名文件'
        try {
          name = decodeURIComponent(String(req.headers['x-file-name'] || name))
        } catch {
          /* use safe default */
        }
        if (!Buffer.isBuffer(req.body)) {
          return reply.code(415).send({
            error: {
              code: 'INVALID_UPLOAD',
              message: '请使用二进制文件上传',
            },
          })
        }
        return reply
          .code(201)
          .send({ data: await p.resources.create(principal, name, req.body) })
      },
    )
    routes.get('/api/v1/resources', async (req) =>
      p.resources.list(
        await p.identity.authenticate(bearer(req.headers.authorization)),
        req.query,
      ))
    routes.get('/api/v1/resources/quota', async (req, reply) => {
      reply.header('Cache-Control', 'no-store')
      return { data: await p.resources.quota(await p.identity.authenticate(bearer(req.headers.authorization))) }
    })
    routes.get('/api/v1/resources/storage', async (_req, reply) => {
      reply.header('Cache-Control', 'no-store')
      return { data: { origin: p.resources.publicOrigin } }
    })
    routes.get<{ Params: { id: string } }>(
      '/api/v1/resources/:id',
      async (req, reply) => {
        reply.header('Cache-Control', 'no-store')
        return { data: await p.resources.get(await p.identity.authenticate(bearer(req.headers.authorization)), req.params.id) }
      },
    )
    routes.get<{ Params: { id: string } }>(
      '/api/v1/resources/:id/content',
      async (req, reply) => {
        const { resource, bytes } = await p.resources.bytes(
          await p.identity.authenticate(bearer(req.headers.authorization)),
          req.params.id,
        )
        return reply
          .header('Cache-Control', 'private, no-store')
          .header('X-Content-Type-Options', 'nosniff')
          .header('Content-Security-Policy', 'default-src \'none\'; sandbox')
          .header(
            'Content-Disposition',
            `${resource.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(resource.name)}`,
          )
          .type(resource.mimeType)
          .send(bytes)
      },
    )
    routes.delete<{ Params: { id: string } }>(
      '/api/v1/resources/:id',
      async (req, reply) => {
        await p.resources.remove(
          await p.identity.authenticate(bearer(req.headers.authorization)),
          req.params.id,
        )
        return reply.code(204).send()
      },
    )
    routes.get('/api/v1/conversations', async (req) => ({
      data: await p.conversations.list(
        await p.identity.authenticate(bearer(req.headers.authorization)),
      ),
    }))
    routes.get<{ Params: { id: string } }>(
      '/api/v1/conversations/:id',
      async (req) => {
        await p.conversations.load(
          await p.identity.authenticate(bearer(req.headers.authorization)),
          parseId(req.params.id),
        )
        return { data: { id: req.params.id } }
      },
    )
    routes.patch<{ Params: { id: string } }>(
      '/api/v1/conversations/:id',
      async (req) => ({
        data: await p.conversations.rename(
          await p.identity.authenticate(bearer(req.headers.authorization)),
          parseId(req.params.id),
          req.body,
        ),
      }),
    )
    routes.delete<{ Params: { id: string } }>(
      '/api/v1/conversations/:id',
      async (req, reply) => {
        await p.conversations.remove(
          await p.identity.authenticate(bearer(req.headers.authorization)),
          req.params.id,
        )
        return reply.code(204).send()
      },
    )
  })
}
