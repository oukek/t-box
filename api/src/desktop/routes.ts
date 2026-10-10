import type { FastifyInstance } from 'fastify'
import type { Actor } from '../application-sdk/contracts.js'
import type { DesktopService } from './service.js'
import { bearer } from '../identity/service.js'
import { desktopDevice } from './service.js'

export function registerDesktop(
  app: FastifyInstance,
  service: DesktopService,
  authenticate: (token: string) => Promise<Actor>,
  aiApplicationIds: ReadonlySet<string>,
) {
  app.get<{ Params: { device: string } }>(
    '/api/v1/desktop/:device',
    async (req, reply) => {
      const actor = await authenticate(bearer(req.headers.authorization))
      const layout = await service.get(
        actor.user.id,
        desktopDevice(req.params.device),
      )
      reply.header('Cache-Control', 'no-store')
      return {
        data: {
          ...layout,
          applications: (await service.applications(actor.user.id)).map(
            (entry) => ({
              ...entry,
              aiAvailable: aiApplicationIds.has(entry.manifest.id),
            }),
          ),
        },
      }
    },
  )
  app.put<{ Params: { device: string } }>(
    '/api/v1/desktop/:device',
    async (req, reply) => {
      const actor = await authenticate(bearer(req.headers.authorization))
      reply.header('Cache-Control', 'no-store')
      return {
        data: await service.save(
          actor.user.id,
          desktopDevice(req.params.device),
          req.body,
        ),
      }
    },
  )
}
