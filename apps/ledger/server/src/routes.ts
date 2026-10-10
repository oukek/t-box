import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { LedgerRuntimeServices } from './ports.js'
import { bearer } from '@t-box/server-foundation/auth'
import { registerLedgerFeatures } from './features/routes.js'
import { parseId, parseSummaryQuery } from './validation.js'

export function registerLedger(app: FastifyInstance, p: LedgerRuntimeServices) {
  const principal = async (req: FastifyRequest) => {
    const actor = await p.identity.authenticate(
      bearer(req.headers.authorization),
    )
    if (
      /^\/api\/v1\/(?:ledgers(?:\/|$)|ledger-invitations\/)/.test(
        req.routeOptions.url || '',
      )
    ) {
      await p.applications?.assertActive(actor.user.id, 'ledger')
    }
    return actor
  }
  registerLedgerFeatures(app, p, principal)
  const id = (req: FastifyRequest) =>
    parseId((req.params as { id: string }).id)
  const key = (req: FastifyRequest) =>
    typeof req.headers['idempotency-key'] === 'string'
      ? req.headers['idempotency-key']
      : undefined
  const subject = (req: FastifyRequest) =>
    parseId((req.params as { subject: string }).subject)
  app.get('/api/v1/ledgers', async (req) => ({
    data: await p.ledgers.list(await principal(req)),
  }))
  app.post('/api/v1/ledgers', async (req, reply) =>
    reply
      .code(201)
      .send({ data: await p.ledgers.create(await principal(req), req.body) }))
  app.post('/api/v1/ledger-invitations/accept', async (req) => ({
    data: await p.ledgers.join(await principal(req), req.body),
  }))
  app.get('/api/v1/ledgers/:id', async (req) => ({
    data: await p.ledgers.get(await principal(req), id(req)),
  }))
  app.patch('/api/v1/ledgers/:id', async (req) => ({
    data: await p.ledgers.update(await principal(req), id(req), req.body),
  }))
  app.post('/api/v1/ledgers/:id/unlock', async (req) => ({
    data: await p.ledgers.unlock(await principal(req), id(req), req.body),
  }))
  app.delete('/api/v1/ledgers/:id/unlock', async (req) => ({
    data: await p.ledgers.lock(await principal(req), id(req)),
  }))
  app.patch('/api/v1/ledgers/:id/password', async (req) => ({
    data: await p.ledgers.password(await principal(req), id(req), req.body),
  }))
  app.post('/api/v1/ledgers/:id/transfer', async (req) => ({
    data: await p.ledgers.transfer(await principal(req), id(req), req.body),
  }))
  app.get('/api/v1/ledgers/:id/members', async (req) => ({
    data: await p.ledgers.members(await principal(req), id(req)),
  }))
  app.patch('/api/v1/ledgers/:id/members/:subject', async (req) => ({
    data: await p.ledgers.changeMember(
      await principal(req),
      id(req),
      subject(req),
      req.body,
    ),
  }))
  app.delete('/api/v1/ledgers/:id/members/:subject', async (req) => ({
    data: await p.ledgers.removeMember(
      await principal(req),
      id(req),
      subject(req),
    ),
  }))
  app.get('/api/v1/ledgers/:id/invites', async (req) => ({
    data: await p.ledgers.invites(await principal(req), id(req)),
  }))
  app.post('/api/v1/ledgers/:id/invites', async (req, reply) =>
    reply.code(201).send({
      data: await p.ledgers.invite(await principal(req), id(req), req.body),
    }))
  app.delete('/api/v1/ledgers/:id/invites/:subject', async (req) => ({
    data: await p.ledgers.revoke(await principal(req), id(req), subject(req)),
  }))
  app.get('/api/v1/ledgers/:id/history', async (req) => ({
    data: await p.ledgers.history(await principal(req), id(req)),
  }))
  app.get('/api/v1/ledgers/:id/categories', async (req) => ({
    data: await p.finance.categories(await principal(req), id(req)),
  }))
  app.post('/api/v1/ledgers/:id/categories', async (req, reply) =>
    reply.code(201).send({
      data: await p.finance.createCategory(
        await principal(req),
        id(req),
        key(req),
        req.body,
      ),
    }))
  app.get('/api/v1/ledgers/:id/bills', async (req) =>
    p.finance.bills(await principal(req), id(req), req.query))
  app.get('/api/v1/ledgers/:id/bills/summary', async (req) => ({
    data: await p.finance.summary(
      await principal(req),
      id(req),
      parseSummaryQuery(req.query),
    ),
  }))
  app.get('/api/v1/ledgers/:id/bills/:subject', async (req) => ({
    data: await p.finance.getBill(await principal(req), id(req), subject(req)),
  }))
  app.post('/api/v1/ledgers/:id/bills', async (req, reply) =>
    reply.code(201).send({
      data: await p.finance.createBill(
        await principal(req),
        id(req),
        key(req),
        req.body,
      ),
    }))
  app.patch('/api/v1/ledgers/:id/bills/:subject', async (req) => ({
    data: await p.finance.updateBill(
      await principal(req),
      id(req),
      subject(req),
      key(req),
      req.body,
    ),
  }))
  app.delete('/api/v1/ledgers/:id/bills/:subject', async (req, reply) => {
    await p.finance.deleteBill(
      await principal(req),
      id(req),
      subject(req),
      key(req),
    )
    return reply.code(204).send()
  })
  app.get('/api/v1/ledgers/:id/debts', async (req) =>
    p.finance.debts(await principal(req), id(req), req.query))
  app.post('/api/v1/ledgers/:id/debts', async (req, reply) =>
    reply.code(201).send({
      data: await p.finance.createDebt(
        await principal(req),
        id(req),
        key(req),
        req.body,
      ),
    }))
  app.get('/api/v1/ledgers/:id/settlements', async (req) => ({
    data: await p.finance.settlements(await principal(req), id(req)),
  }))
  app.post('/api/v1/ledgers/:id/settlements', async (req, reply) =>
    reply.code(201).send({
      data: await p.finance.settle(
        await principal(req),
        id(req),
        key(req),
        req.body,
      ),
    }))
  app.post(
    '/api/v1/ledgers/:id/settlements/:subject/reversal',
    async (req) => ({
      data: await p.finance.reverseSettlement(
        await principal(req),
        id(req),
        subject(req),
        key(req),
      ),
    }),
  )
  app.get('/api/v1/ledgers/:id/statistics', async (req) => ({
    data: await p.statistics.get(await principal(req), id(req), req.query),
  }))
  app.post('/api/v1/ledgers/:id/statistics/rebuild', async (req) => ({
    data: await p.statistics.rebuild(await principal(req), id(req)),
  }))
  app.get('/api/v1/ledgers/:id/events', async (req) =>
    p.finance.events(await principal(req), id(req), req.query))
}
