import type { Actor } from '@t-box/app-server-sdk'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { CalendarService } from './service.js'
import { calendarObject } from '@t-box/calendar-contracts'
import { bearer } from '@t-box/server-foundation/auth'
import { temporalDomain } from '@t-box/server-foundation/persistence/errors'
import { validDate } from '@t-box/time-contracts'

export function registerCalendar(
  app: FastifyInstance,
  service: CalendarService,
  authenticate: (token: string) => Promise<Actor>,
) {
  const user = async (req: FastifyRequest) =>
    (await authenticate(bearer(req.headers.authorization))).user.id
  const id = (req: FastifyRequest) => (req.params as { id: string }).id
  const key = (req: FastifyRequest) => req.headers['idempotency-key']
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/v1/calendar')) {
      reply.header('Cache-Control', 'no-store')
    }
  })
  app.addHook('onReady', async () => {
    service.holidays.start((error) =>
      app.log.warn({ err: error }, 'Calendar holiday sync failed'),
    )
  })
  app.addHook('onClose', async () => {
    await service.holidays.stop()
  })
  app.get('/api/v1/calendar/holiday-years/:year', async (req) => {
    await user(req)
    return {
      data: await service.holidays.getYear(
        (req.params as { year: string }).year,
      ),
    }
  })
  app.get('/api/v1/calendar/date-info', async (req) => {
    await user(req)
    const date = temporalDomain(() =>
      validDate(calendarObject(req.query, ['date']).date),
    )
    return { data: await service.holidays.dateInfo(date) }
  })
  app.get('/api/v1/calendar/events', async (req) => ({
    data: await service.events(
      await user(req),
      (req.query as { search?: string }).search,
    ),
  }))
  app.get('/api/v1/calendar/occurrences', async (req) => ({
    data: await service.occurrences(await user(req), req.query),
  }))
  app.get('/api/v1/calendar/reminders', async (req) => ({
    data: await service.reminders(
      await user(req),
      (req.query as { timezone?: string }).timezone,
    ),
  }))
  app.get('/api/v1/calendar/events/:id', async (req) => ({
    data: await service.get(await user(req), id(req)),
  }))
  app.get('/api/v1/calendar/events/:id/occurrence-states', async (req) => ({
    data: await service.states(await user(req), id(req)),
  }))
  app.post('/api/v1/calendar/events', async (req, reply) =>
    reply.code(201).send({
      data: await service.create(await user(req), key(req), req.body),
    }))
  app.patch('/api/v1/calendar/events/:id', async (req) => ({
    data: await service.update(await user(req), id(req), key(req), req.body),
  }))
  app.delete('/api/v1/calendar/events/:id', async (req) => ({
    data: await service.remove(await user(req), id(req), key(req), req.body),
  }))
  app.post('/api/v1/calendar/events/:id/occurrence-state', async (req) => ({
    data: await service.occurrenceState(
      await user(req),
      id(req),
      key(req),
      req.body,
    ),
  }))
}
