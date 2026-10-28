import type { AppRelease } from '@t-box/app-contracts'
import type { ApplicationBackend } from '@t-box/app-server-sdk'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { calculatorBackend } from '@t-box/calculator-server'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { IdentityService } from '../src/identity/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const marker = randomUUID().slice(0, 8)
const legacyId = 'test_migrate_' + marker
const systemId = 'test_system_migrate_' + marker
const brokenId = 'test_broken_' + marker
const slowId = 'test_slow_' + marker
const users: string[] = []
const fixture = (appId: string, kind: 'user' | 'system' = 'user'): AppRelease => ({
  appId,
  releaseId: appId + '-1.0.0',
  protocol: 1,
  kind,
  manifest: { id: appId, name: appId, description: 'fixture', icon: 'apps', color: 'blue', version: '1.0.0', skillIds: [] },
  runtime: { type: 'shell' },
  backend: { type: 'none', binding: '' },
  platforms: ['web', 'android', 'ios'],
  permissions: [],
  clientTools: [],
  defaultInstalled: true,
})
const legacy = fixture(legacyId)
const legacySystem = fixture(systemId, 'system')
const broken = { ...fixture(brokenId, 'system'), backend: { type: 'local' as const, binding: brokenId } }
let shouldReject = true
let attempts = 0
const backend: ApplicationBackend = {
  async lifecycle() {
    attempts++
    return shouldReject ? { status: 'rejected', message: 'fixture dependency unavailable' } : { status: 'completed', receipt: {} }
  },
  async operation() {
    return null
  },
  async invoke() {
    return {}
  },
}
const bind = (platform: ApplicationPlatform) => {
  platform.bind('calculator', calculatorBackend)
  platform.bind(brokenId, backend)
  return platform
}
let unblock: (() => void) | undefined
let slowDone: Promise<void> | undefined
try {
  const identity = new IdentityService(source, undefined, 'internal')
  const a = await identity.register({ username: 'health_a_' + marker, password: 'test123', nickname: '测试甲' }, 'health-fixture')
  const b = await identity.register({ username: 'health_b_' + marker, password: 'test123', nickname: '测试乙' }, 'health-fixture')
  users.push(a.user.id, b.user.id)
  const original = bind(new ApplicationPlatform(source, [legacy, broken, legacySystem]))
  await original.catalog(a.user.id)
  await original.catalog(b.user.id)
  const oldInstall = (await original.assertActive(a.user.id, legacyId)).installation
  assert.equal((await original.catalog(a.user.id)).find((e) => e.release.appId === brokenId)?.installation?.status, 'failed')
  assert.equal((await original.assertActive(a.user.id, legacyId)).installation.status, 'active', 'one failed system app must not block other applications')
  await assert.rejects(original.change(a.user.id, brokenId, 'uninstall', broken.releaseId, randomUUID(), []), /系统应用/)
  await original.change(b.user.id, legacyId, 'uninstall', legacy.releaseId, randomUUID(), [])

  const upgraded: AppRelease = {
    ...legacy,
    releaseId: legacyId + '-1.1.0-web',
    manifest: { ...legacy.manifest, version: '1.1.0' },
    runtime: { type: 'web', entryUrl: 'http://localhost:5177/', integrity: 'sha256-' + '0'.repeat(64) },
    permissions: ['api.request', 'storage', 'resources.bindings'],
  }
  const upgradedSystem: AppRelease = { ...legacySystem, releaseId: systemId + '-1.1.0-web', manifest: { ...legacySystem.manifest, version: '1.1.0' }, runtime: { type: 'web', entryUrl: 'http://localhost:5178/', integrity: 'sha256-' + '0'.repeat(64) }, permissions: ['api.request', 'storage', 'device.reminders'] }
  const migrated = bind(new ApplicationPlatform(source, [upgraded, broken, upgradedSystem], {}, { shellMigrations: [legacyId, systemId] }))
  const system = await migrated.assertActive(a.user.id, systemId)
  assert.equal(system.release.runtime.type, 'web')
  assert.deepEqual(system.installation.grants, upgradedSystem.permissions)
  assert.ok((await migrated.context(a.user.id, systemId, 'web')).capabilities.includes('device.reminders'))
  await assert.rejects(migrated.change(a.user.id, systemId, 'uninstall', upgradedSystem.releaseId, randomUUID(), []), /系统应用/)
  const current = await migrated.assertActive(a.user.id, legacyId)
  assert.equal(current.release.releaseId, upgraded.releaseId)
  assert.equal(current.installation.generation, oldInstall.generation + 1)
  assert.deepEqual(current.installation.grants, upgraded.permissions)
  await assert.rejects(migrated.assertActive(a.user.id, legacyId, oldInstall), /重新打开/)
  await assert.rejects(migrated.assertActive(b.user.id, legacyId), /安装/)
  const [tombstone] = await source.query('SELECT status FROM application_installations WHERE user_id=? AND app_id=?', [b.user.id, legacyId])
  assert.equal(tombstone.status, 'revoked')
  const [oldDefinition] = await source.query('SELECT definition,status FROM application_releases WHERE release_id=?', [legacy.releaseId])
  assert.equal(oldDefinition.status, 'retired')
  const definition = typeof oldDefinition.definition === 'string' ? JSON.parse(oldDefinition.definition) : oldDefinition.definition
  assert.equal(definition.runtime.type, 'shell')

  const beforeRetry = attempts
  shouldReject = false
  await source.query('UPDATE application_installations SET retry_at=UTC_TIMESTAMP(3) WHERE app_id=?', [brokenId])
  migrated.invalidateCatalog()
  assert.equal((await migrated.assertActive(a.user.id, brokenId)).installation.status, 'active')
  assert.equal(attempts, beforeRetry + 1)
  shouldReject = true
  await source.query('UPDATE application_installations SET status=\'failed\',retry_attempts=5,retry_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?', [a.user.id, brokenId])
  const atLimit = attempts
  migrated.invalidateCatalog()
  await migrated.catalog(a.user.id)
  assert.equal(attempts, atLimit, 'automatic rejected retries stop after five attempts')
  shouldReject = false
  assert.equal((await migrated.repair(a.user.id, brokenId)).status, 'completed')
  assert.equal((await migrated.assertActive(a.user.id, brokenId)).installation.status, 'active')

  await source.query('UPDATE application_installations SET status=\'failed\',retry_attempts=2,retry_at=UTC_TIMESTAMP(3) WHERE user_id=? AND app_id=?', [b.user.id, brokenId])
  await migrated.recover()
  assert.equal((await migrated.assertActive(b.user.id, brokenId)).installation.status, 'active', 'background recovery repairs due system installations without reopening their UI')

  const slow: AppRelease = { ...fixture(slowId, 'system'), backend: { type: 'remote', binding: slowId } }
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let finish!: () => void
  slowDone = new Promise<void>((resolve) => {
    finish = resolve
  })
  const worker = bind(new ApplicationPlatform(source, [upgraded, broken, slow], {}, { shellMigrations: [legacyId] }))
  worker.bind(slowId, {
    async lifecycle() {
      await gate
      finish()
      return { status: 'completed', receipt: {} }
    },
    async operation() {
      return null
    },
    async invoke() {
      return {}
    },
  })
  const catalog = await Promise.race([worker.catalog(a.user.id), new Promise<never>((_, reject) => setTimeout(() => reject(new Error('remote install blocked the catalog')), 2000))])
  assert.equal(catalog.find((e) => e.release.appId === slowId)?.installation?.status, 'installing')
  assert.equal((await worker.assertActive(a.user.id, legacyId)).installation.status, 'active')
  unblock!()
  await slowDone
  for (let i = 0; i < 100; i++) {
    const [row] = await source.query('SELECT status FROM application_installations WHERE app_id=? AND user_id=?', [slowId, a.user.id])
    if (row.status === 'active') {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.equal((await worker.assertActive(a.user.id, slowId)).installation.status, 'active')
  console.info('Installation health passed: trusted shell migration, immutable history, preserved uninstall, permission fencing, system uninstall rejection, failed-app isolation, bounded rejected retries, manual repair and nonblocking remote installation.')
} finally {
  unblock?.()
  if (slowDone) {
    await slowDone
  }
  for (const appId of [legacyId, brokenId, slowId, systemId]) {
    await source.query('DELETE FROM application_lifecycle_operations WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_installations WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_publication_events WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_releases WHERE app_id=?', [appId])
    await source.query('DELETE FROM application_registry WHERE app_id=?', [appId])
  }
  await cleanupUsers(source, users)
  await source.destroy()
}
