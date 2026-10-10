import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CategoryPresetAdministration } from './administration.js'

export function registerLedgerCategoryAdministration(
  app: FastifyInstance,
  service: CategoryPresetAdministration,
  authenticate: (r: FastifyRequest) => Promise<{ id: string }>,
) {
  app.get('/ledger/category-presets', async () => ({
    data: await service.list(),
  }))
  app.post('/ledger/category-presets', async (r, reply) =>
    reply
      .code(201)
      .send({ data: await service.save(r.body, (await authenticate(r)).id) }))
  app.patch<{ Params: { id: string } }>(
    '/ledger/category-presets/:id',
    async (r) => ({
      data: await service.save(r.body, (await authenticate(r)).id, r.params.id),
    }),
  )
}
