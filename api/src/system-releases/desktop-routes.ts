import type { FastifyInstance } from 'fastify'
import type { DataSource } from 'typeorm'
import { SystemDesktopCandidate } from '../db/records/system-versions.js'
import { desktopStorage, installer, isMacArch, updateArchive } from './desktop-artifacts.js'
import { desktopPlan } from './desktop-candidates.js'

export function registerDesktopUpdates(app: FastifyInstance, source: DataSource, store?: ReturnType<typeof desktopStorage>) {
  app.get('/api/v1/system-updates/macos/installers', async (_r, reply) => {
    const live = await source.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
    return reply.header('Cache-Control', 'no-store').send({ architectures: live ? live.core.distribution ? ['aarch64', 'x86_64'] : ['aarch64'] : [] })
  })
  app.get<{ Params: { arch: string } }>('/api/v1/system-updates/macos/:arch/installer', async (r, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (!isMacArch(r.params.arch)) {
      return reply.code(404).send()
    }
    const live = await source.manager.findOneBy(SystemDesktopCandidate, { state: 'live' })
    const file = live && installer(live.core, r.params.arch)
    return file ? reply.redirect(await (store ?? desktopStorage()).url(file.kind, file.item, `Tbox-${file.item.version}-${r.params.arch}.${file.extension}`)) : reply.code(404).send()
  })
  app.get<{ Querystring: Record<string, unknown> }>('/api/v1/system-updates', async (r, reply) => {
    const plan = await desktopPlan(source, r.query, store)
    reply.header('Cache-Control', 'no-store')
    return plan ? reply.send(plan) : reply.code(204).send()
  })
  app.get<{ Params: { build: string }, Querystring: { arch?: string } }>('/api/v1/system-updates/:build/core', async (r, reply) => {
    reply.header('Cache-Control', 'no-store')
    const arch = r.query.arch ?? 'aarch64'
    if (!isMacArch(arch)) {
      return reply.code(404).send()
    }
    const row = await source.manager.findOneBy(SystemDesktopCandidate, { build: r.params.build, state: 'live' })
    const item = row && updateArchive(row.core, arch)
    return item ? reply.send({ version: item.version, url: await (store ?? desktopStorage()).url('core', item), signature: item.signature }) : reply.code(404).send()
  })
}
