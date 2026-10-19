import type { AppRelease } from '@t-box/app-contracts'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { registerApplicationPlatform } from '../src/application-platform/routes.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { ApplicationInstallationEntity, ApplicationRegistryEntity, ApplicationReleaseEntity } from '../src/db/records/applications-entities.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Select an explicitly disposable database')
}
const source = await createDataSource().initialize()
const appId = `guest_${randomUUID().replaceAll('-', '').slice(0, 20)}`
const release = (version: string, guestAccess?: 'local'): AppRelease => ({
  appId,
  releaseId: `${appId}-${version}`,
  guestAccess,
  kind: 'system',
  protocol: 1,
  defaultInstalled: true,
  platforms: ['web'],
  manifest: { id: appId, name: '本地测试', description: '', icon: 'apps', color: 'blue', version, skillIds: [] },
  runtime: { type: 'web', entryUrl: `https://apps.test/${appId}/${'a'.repeat(64)}/`, integrity: 'sha256-' + 'a'.repeat(64) },
  backend: { type: 'none', binding: '' },
  permissions: ['storage'],
  clientTools: [],
})
const first = release('1.0.0')
const next = release('1.1.0', 'local')
const platform = new ApplicationPlatform(source, [first, next])
const app = Fastify()
registerApplicationPlatform(app, platform, async () => {
  assert.fail('Guest metadata must not authenticate')
})
try {
  // A new source declaration cannot make an older, server-dependent release guest-compatible.
  const initial = await app.inject('/api/v1/app-market/local')
  assert.equal(initial.statusCode, 200)
  assert.deepEqual(initial.json<{ applications: AppRelease[] }>().applications, [])
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: first.releaseId }, { published: 0, status: 'retired' })
  assert.deepEqual(await platform.publicLocalCatalog(), [], 'submitted versions are never exposed as the fallback')
  await source.getRepository(ApplicationReleaseEntity).update({ release_id: next.releaseId }, { published: 1, status: 'published' })
  assert.equal((await platform.publicLocalCatalog())[0]?.releaseId, next.releaseId)
  assert.equal(await source.getRepository(ApplicationInstallationEntity).count({ where: { app_id: appId } }), 0, 'public discovery must not create account installations')
  console.info('Public guest catalog: published-only, anonymous, no installation writes.')
} finally {
  await app.close()
  await source.getRepository(ApplicationReleaseEntity).delete({ app_id: appId })
  await source.getRepository(ApplicationRegistryEntity).delete({ app_id: appId })
  await source.destroy()
}
