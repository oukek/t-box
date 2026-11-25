import type { FastifyInstance } from 'fastify'
import type { DataSource } from 'typeorm'
import { SystemDesktopCandidate } from '../db/records/system-versions.js'
import { desktopStorage } from './desktop-artifacts.js'
import { desktopPlan } from './desktop-candidates.js'

export function registerDesktopUpdates(app: FastifyInstance, source: DataSource, store?: ReturnType<typeof desktopStorage>) {
  app.get('/api/v1/system-updates/macos/aarch64/installer', async (_r, reply) => {
    const live = await source.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
    reply.header('Cache-Control', 'no-store')
    return live ? reply.redirect(await (store ?? desktopStorage()).url('core', live.core)) : reply.code(404).send()
  })
  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/system-updates', async (r, reply) => {
    const plan = await desktopPlan(source, r.query, store)
    reply.header('Cache-Control', 'no-store')
    return plan ? reply.send(plan) : reply.code(204).send()
  })
  app.get<{ Params: { build: string } }>('/api/v1/system-updates/:build/core', async (r, reply) => {
    const row = await source.manager.findOneBy(SystemDesktopCandidate, { build: r.params.build, state: 'live' })
    reply.header('Cache-Control', 'no-store')
    return row ? reply.send({ version: row.core.version, url: await (store ?? desktopStorage()).url('core', row.core), signature: row.core.signature }) : reply.code(404).send()
  })
}
