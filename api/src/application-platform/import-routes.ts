import type { FastifyInstance } from 'fastify'
import type { DataSource } from 'typeorm'
import type { ApplicationBuildImports } from './build-import.js'
import { SystemDesktopCandidate, SystemWebCandidate } from '../db/records/system-versions.js'

import { desktopStorage } from '../system-releases/desktop-artifacts.js'

import { registerDesktop } from '../system-releases/desktop-candidates.js'
import { registerDesktopUpdates } from '../system-releases/desktop-routes.js'
import { reserveSystemVersions } from '../system-releases/reserve.js'
import { registerWebCandidate } from '../system-releases/web-candidates.js'

export function registerApplicationBuildImports(app: FastifyInstance, source: DataSource, service: ApplicationBuildImports) {
  const ci = { onRequest: async (r: import('fastify').FastifyRequest) => {
    await service.authenticate(r.headers.authorization, true)
  } }
  app.get('/api/v1/system-builds/desktop/base', ci, async (_r, reply) => {
    const live = await source.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
    return reply.header('Cache-Control', 'no-store').send({ data: live && { build: live.build, ui: live.ui, url: await desktopStorage().url('ui', live.ui) } })
  })
  app.get<{ Params: { build: string } }>('/api/v1/system-builds/desktop/:build/status', ci, async (r, reply) => {
    const where = { build: r.params.build }
    const [desktop, web] = await Promise.all([source.manager.existsBy(SystemDesktopCandidate, where), source.manager.existsBy(SystemWebCandidate, where)])
    return reply.header('Cache-Control', 'no-store').send({ data: { desktop, web } })
  })
  app.post('/api/v1/system-builds/desktop', ci, async (r, reply) => reply.header('Cache-Control', 'no-store').send({ data: await registerDesktop(source, r.body) }))
  registerDesktopUpdates(app, source)
  app.post('/api/v1/system-builds/reserve', {
    onRequest: async (r) => {
      await service.authenticate(r.headers.authorization, true)
    },
  }, async (r, reply) => {
    const data = await reserveSystemVersions(source, r.body)
    return reply.header('Cache-Control', 'no-store').send({ data })
  })
  app.post('/api/v1/system-builds/submit', {
    onRequest: async (r) => {
      await service.authenticate(r.headers.authorization, true)
    },
  }, async (r, reply) => reply.header('Cache-Control', 'no-store').send({ data: await registerWebCandidate(source, r.body) }))
  app.post('/api/v1/application-builds', {
    onRequest: async (r) => {
      await service.authenticate(r.headers.authorization)
    },
  }, async (r, reply) => {
    const actor = await service.authenticate(r.headers.authorization)
    const data = await service.submit(r.body, actor)
    return reply.code(201).header('Cache-Control', 'no-store').send({ data })
  })
}
