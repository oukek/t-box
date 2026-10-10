import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { HolidayService } from './holiday-service.js'
import { calendarObject, holidayYear } from '@t-box/calendar-contracts'
import { temporalDomain } from '@t-box/server-foundation/persistence/errors'

export function registerHolidayAdministration(
  app: FastifyInstance,
  service: HolidayService,
  authenticate: (r: FastifyRequest) => Promise<{ id: string }>,
) {
  const year = (r: FastifyRequest) =>
    temporalDomain(() => holidayYear((r.params as { year: string }).year))
  app.get('/calendar/holidays', async () => ({
    data: { settings: await service.settings(), years: await service.list() },
  }))
  app.patch('/calendar/holiday-settings', async (r) => ({
    data: await service.configure(r.body, (await authenticate(r)).id),
  }))
  app.post('/calendar/holiday-years/:year/sync', async (r) => {
    await service.sync(year(r), true, (await authenticate(r)).id)
    return { data: (await service.list()).find((y) => y.year === year(r)) }
  })
  app.get('/calendar/holiday-years/:year/audit', async (r) => ({
    data: await service.audit(year(r)),
  }))
  app.put(
    '/calendar/holiday-years/:year/draft',
    { bodyLimit: 65536 },
    async (r) => {
      const actor = await authenticate(r)
      const body = temporalDomain(() =>
        calendarObject(r.body, ['revision', 'data']),
      )
      return {
        data: await service.edit(
          year(r),
          body.revision,
          body.data,
          'draft',
          actor.id,
        ),
      }
    },
  )
  for (const action of ['publish', 'automatic'] as const) {
    app.post(`/calendar/holiday-years/:year/${action}`, async (r) => {
      const actor = await authenticate(r)
      const body = temporalDomain(() => calendarObject(r.body, ['revision']))
      return {
        data: await service.edit(
          year(r),
          body.revision,
          null,
          action,
          actor.id,
        ),
      }
    })
  }
}
