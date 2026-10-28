import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { ApplicationArtifacts } from '../src/application-platform/artifacts.js'
import { registerApplicationPlatform } from '../src/application-platform/routes.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { ApplicationRegistryEntity, ApplicationReleaseEntity } from '../src/db/records/applications-entities.js'
import { IdentityService } from '../src/identity/service.js'
import { cleanupUsers } from './fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Select an explicitly disposable database')
}
const source = await createDataSource().initialize()
const identity = new IdentityService(source, undefined, 'internal')
const appId = `resource_${randomUUID().replaceAll('-', '').slice(0, 20)}`
const release = (version: string, permissions: string[] = []): AppRelease => ({ appId, releaseId: `${appId}-${version}`, protocol: 1, kind: 'user', platforms: ['web', 'android', 'ios'], defaultInstalled: false, clientTools: [], permissions, manifest: { id: appId, name: '资源测试', description: 'test', version, icon: 'apps', color: 'blue', skillIds: [] }, backend: { type: 'none', binding: '' }, runtime: { type: 'web', entryUrl: `https://apps.test/${appId}/${'a'.repeat(64)}/`, integrity: 'sha256-' + 'a'.repeat(64) } })
const first = release('1.0.0')
const second = release('1.1.0')
const third = release('1.2.0')
const privileged = release('2.0.0', ['files'])
const platform = new ApplicationPlatform(source, [first, second, third, privileged])
const app = Fastify()
registerApplicationPlatform(app, platform, (token) => identity.authenticate(token))
const users: string[] = []
const verify = ApplicationArtifacts.prototype.verify
try {
  const session = await identity.register({ username: appId, password: 'test123', nickname: '资源测试' }, '127.0.0.1')
  users.push(session.user.id)
  await platform.initialize()
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: first.releaseId }, { published: 1, status: 'published' })
  await platform.change(session.user.id, appId, 'install', first.releaseId, randomUUID(), [])
  ApplicationArtifacts.prototype.verify = async () => {
    throw new Error('Launch must never download the public package on the server')
  }
  assert.equal((await platform.runtime(session.user.id, appId, 'web')).integrity, 'sha256-' + 'a'.repeat(64))
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: first.releaseId }, { published: 0, status: 'retired' })
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: second.releaseId }, { published: 1, status: 'published' })
  await platform.change(session.user.id, appId, 'update', second.releaseId, randomUUID(), [])
  const catalog = await platform.catalog(session.user.id)
  assert.equal(catalog.find((entry) => entry.release.appId === appId)?.installedRelease?.releaseId, second.releaseId)
  assert.deepEqual(catalog.find((entry) => entry.release.appId === appId)?.localBinding, { subject: platform.subject(session.user.id, appId), storage: false }, 'local bootstrap has only a scoped identity and device storage flag; no bearer or backend authority')
  const headers = { 'authorization': `Bearer ${session.token}`, 'idempotency-key': randomUUID() }
  const rolledBack = await app.inject({ method: 'POST', url: `/api/v1/applications/${appId}/rollback`, headers, payload: { failedReleaseId: second.releaseId, releaseId: first.releaseId } })
  assert.equal(rolledBack.statusCode, 200, rolledBack.body)
  assert.equal(rolledBack.json().data.status, 'completed')
  const repeated = await app.inject({ method: 'POST', url: `/api/v1/applications/${appId}/rollback`, headers, payload: { failedReleaseId: second.releaseId, releaseId: first.releaseId } })
  assert.equal(repeated.json().data.id, rolledBack.json().data.id, 'uncertain network replies are idempotent')
  assert.equal((await platform.runtime(session.user.id, appId, 'ios')).releaseId, first.releaseId)
  for (const target of [third.releaseId, privileged.releaseId]) {
    await assert.rejects(platform.change(session.user.id, appId, 'update', target, randomUUID(), target === privileged.releaseId ? ['files'] : [], { rollbackFrom: first.releaseId }), { code: 'APP_ROLLBACK_REJECTED' })
  }
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: privileged.releaseId }, { published: 1, status: 'published' })
  await platform.change(session.user.id, appId, 'update', privileged.releaseId, randomUUID(), ['files'])
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: privileged.releaseId }, { published: 0, status: 'retired' })
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: third.releaseId }, { published: 1, status: 'published' })
  await platform.change(session.user.id, appId, 'update', third.releaseId, randomUUID(), [])
  await assert.rejects(platform.change(session.user.id, appId, 'update', privileged.releaseId, randomUUID(), ['files'], { rollbackFrom: third.releaseId }), { code: 'APP_ROLLBACK_REJECTED' })
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: first.releaseId }, { published: 0, status: 'submitted' })
  await assert.rejects(platform.change(session.user.id, appId, 'update', first.releaseId, randomUUID(), [], { rollbackFrom: third.releaseId }), { code: 'APP_RELEASE_UNPUBLISHED' })
  assert.equal((await platform.runtime(session.user.id, appId, 'web')).releaseId, third.releaseId)
  await assert.rejects(platform.change(session.user.id, appId, 'update', second.releaseId, randomUUID(), [], { rollbackFrom: 'stale-device-version' }), { code: 'APP_ROLLBACK_REJECTED' })
  const report = await app.inject({ method: 'POST', url: `/api/v1/applications/${appId}/launches`, headers, payload: { id: randomUUID(), appId, releaseId: first.releaseId, source: 'local', platform: 'web', outcome: 'ready', totalMs: 15, stages: { loading: 15 } } })
  assert.equal(report.statusCode, 204, report.body)
  const privateReport = await app.inject({ method: 'POST', url: `/api/v1/applications/${appId}/launches`, headers, payload: { token: session.token } })
  assert.equal(privateReport.statusCode, 400)
  console.info('Runtime skips server downloads; authenticated retired-version rollback, idempotency, stale-device guards, permission/history checks and launch telemetry passed')
} finally {
  ApplicationArtifacts.prototype.verify = verify
  await app.close()
  await cleanupUsers(source, users)
  await source.getRepository(ApplicationReleaseEntity).delete({ app_id: appId })
  await source.getRepository(ApplicationRegistryEntity).delete({ app_id: appId })
  await source.destroy()
}
