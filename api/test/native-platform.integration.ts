import type { AppRelease, InstalledApplicationAction } from '@t-box/app-contracts'
import type { ApplicationBackend } from '@t-box/app-server-sdk'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createConnection } from 'mysql2/promise'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { HostDownloadConfiguration } from '../src/application-platform/download-settings.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { ApplicationMarketPolicy } from '../src/application-platform/settings.js'
import { getConfig } from '../src/config.js'
import { ConfigurationCache } from '../src/configuration/cache.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { PlatformConfigurationStateEntity } from '../src/db/records/configuration-entities.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { NativeActionSessions } from '../src/identity/native-sessions.js'
import { PlatformService } from '../src/platform/service.js'

const config = getConfig().mysql
const { database: _database, ...connection } = config
const admin = await createConnection(connection)
const database = `t_box_test_native_${randomUUID().replaceAll('-', '')}`
const source = createDataSource({ ...config, database })
let created = false
let close: (() => Promise<unknown>) | undefined
try {
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
  created = true
  await source.initialize()
  await initializeDatabase(source, databaseSchemas)
  const cached = new Map<string, string>()
  const cache = new ConfigurationCache({ isReady: true, get: async (key) => cached.get(key) ?? null, set: async (key, value) => {
    cached.set(key, value)
  } }, database)
  const policy = new ApplicationMarketPolicy(source, cache)
  assert.deepEqual(await policy.read(), { hidden: false })
  const administrator = randomUUID()
  const state = await source.getRepository(PlatformConfigurationStateEntity).findOneByOrFail({ id: 1 })
  await policy.save({ hidden: true }, administrator)
  assert.deepEqual(await new ApplicationMarketPolicy(source, cache).read(), { hidden: true })
  assert.ok(cached.size >= 2)
  assert.equal((await source.getRepository(PlatformConfigurationStateEntity).findOneByOrFail({ id: 1 })).ai_revision, state.ai_revision)
  await assert.rejects(policy.save({ hidden: 'true' }, administrator), { code: 'INVALID_MARKET_SETTINGS' })
  const downloads = new HostDownloadConfiguration(source, cache)
  assert.equal((await downloads.read()).iosAppStoreUrl, '')
  const downloadConfig = { displayName: '测试应用', iosAppStoreUrl: 'https://apps.apple.com/cn/app/id123456789', androidDownloadUrl: 'https://example.com/android' }
  await downloads.save(downloadConfig, administrator)
  assert.deepEqual(await new HostDownloadConfiguration(source, cache).read(), downloadConfig)
  assert.deepEqual(await policy.read(), { hidden: true })
  assert.equal((await source.getRepository(PlatformConfigurationStateEntity).findOneByOrFail({ id: 1 })).ai_revision, state.ai_revision)
  await assert.rejects(downloads.save({ ...downloadConfig, iosAppStoreUrl: 'https://example.com' }, administrator), { code: 'INVALID_HOST_DOWNLOADS' })

  const release = (id: string, kind: 'system' | 'user'): AppRelease => ({ appId: id, releaseId: `${id}-1`, manifest: { id, name: id, description: 'fixture', icon: 'apps', color: 'blue', version: '1.0.0', skillIds: [] }, protocol: 1, kind, platforms: ['web', 'ios'], runtime: { type: 'shell' }, backend: { type: 'local', binding: 'fixture' }, permissions: [`${id}.echo`, `${id}.write`], clientTools: [], defaultInstalled: kind === 'system' })
  const receipts = new Map<string, unknown>()
  let writes = 0
  const backend: ApplicationBackend = {
    actions: [{ id: 'echo', version: 1, title: '查询', description: '', inputSchema: { type: 'object' }, effect: 'read', background: true }, { id: 'write', version: 1, title: '写入', description: '', inputSchema: { type: 'object' }, effect: 'write', background: true }],
    async lifecycle() {
      return { status: 'completed', receipt: {} }
    },
    async operation() {
      return null
    },
    async invoke(request) {
      if (request.method === 'echo') {
        return request.arguments
      }
      if (receipts.has(request.invocationId)) {
        return receipts.get(request.invocationId)
      }
      const result = { count: ++writes }
      receipts.set(request.invocationId, result)
      return result
    },
  }
  const fixture = new ApplicationPlatform(source, [release('native-system', 'system'), release('native-user', 'user')], {}, { marketPolicy: policy })
  fixture.bind('fixture', backend)
  const platform = new PlatformService(source)
  const user = await platform.identity.register({ username: 'native_fixture', password: 'test123' }, 'native-fixture')
  const other = await platform.identity.register({ username: 'native_other', password: 'test123' }, 'native-other')
  await fixture.bootstrap(user.user.id)
  assert.equal((await fixture.catalog(user.user.id)).find((entry) => entry.release.appId === 'native-system')?.installation?.status, 'active')
  await assert.rejects(fixture.change(user.user.id, 'native-user', 'install', 'native-user-1', randomUUID(), ['native-user.echo', 'native-user.write']), { code: 'APP_MARKET_HIDDEN' })
  await policy.save({ hidden: false }, administrator)
  await fixture.change(user.user.id, 'native-user', 'install', 'native-user-1', randomUUID(), ['native-user.echo', 'native-user.write'])
  await policy.save({ hidden: true }, administrator)
  assert.equal((await fixture.repair(user.user.id, 'native-user')).status, 'completed')
  await fixture.change(user.user.id, 'native-user', 'uninstall', 'native-user-1', randomUUID(), [])
  await assert.rejects(fixture.change(user.user.id, 'native-user', 'install', 'native-user-1', randomUUID(), ['native-user.echo']), { code: 'APP_MARKET_HIDDEN' })

  await fixture.change(user.user.id, 'native-system', 'update', 'native-system-1', randomUUID(), ['native-system.echo', 'native-system.write'])
  const sessions = new NativeActionSessions(platform.identity)
  const native = await sessions.issue(user.token, {})
  assert.equal((await sessions.authenticate(native.token)).user.id, user.user.id)
  await assert.rejects(platform.identity.authenticate(native.token), { code: 'UNAUTHENTICATED' })
  await assert.rejects(sessions.authenticate(user.token), { code: 'UNAUTHENTICATED' })

  // Attach the independently registered fixture without adding business logic to the native gateway.
  Object.defineProperty(platform, 'applications', { value: fixture })
  const adminStore = new AdminStore(source)
  await adminStore.createUser('native_fixture_admin', await hashPassword('fixture123'))
  const administration = new ConfigurationService(adminStore, createVault(randomBytes(32)))
  const app = createApp({ platform, administration, taskWorker: false, bills: createBillRepository(source), health: async () => ({ mysql: 'up', redis: 'disabled' }) })
  close = () => app.close()
  const actions = await app.inject({ method: 'GET', url: '/api/v1/native/actions', headers: { authorization: `Bearer ${user.token}` } })
  assert.equal(actions.statusCode, 200)
  const action = actions.json<{ data: InstalledApplicationAction[] }>().data.find((entry) => entry.appId === 'native-system' && entry.id === 'write')!
  assert.ok(action)
  const key = randomUUID()
  const invoke = (token: string, generation = action.generation) => app.inject({ method: 'POST', url: `/api/v1/native/actions/${action.appId}/${action.id}`, headers: { 'authorization': `Bearer ${token}`, 'idempotency-key': key }, payload: { releaseId: action.releaseId, generation, actionVersion: action.version, arguments: {} } })
  const first = await invoke(native.token)
  assert.equal(first.statusCode, 200, first.body)
  assert.deepEqual((await invoke(native.token)).json(), first.json())
  assert.equal(writes, 1)
  assert.equal((await invoke(native.token, action.generation + 1)).statusCode, 409)
  assert.equal((await invoke(other.token)).statusCode, 401)
  const hidden = await app.inject({ method: 'GET', url: '/api/v1/app-market', headers: { authorization: `Bearer ${user.token}` } })
  assert.equal(hidden.json().settings.hidden, true)
  assert.ok(hidden.json<{ data: { release: { appId: string } }[] }>().data.every((entry) => entry.release.appId !== 'native-user'))
  const publicPolicy = await app.inject({ method: 'GET', url: '/api/v1/app-market/settings' })
  assert.deepEqual(publicPolicy.json().data, { hidden: true })
  const publicDownloads = await app.inject({ method: 'GET', url: '/api/v1/host/downloads' })
  assert.equal(publicDownloads.statusCode, 200)
  assert.deepEqual(publicDownloads.json().data, downloadConfig)
  const adminUrl = '/api/v1/admin/host/downloads'
  assert.equal((await app.inject({ method: 'PATCH', url: adminUrl, headers: { 'x-admin-request': '1' }, payload: downloadConfig })).statusCode, 401)
  const adminLogin = await app.inject({ method: 'POST', url: '/api/v1/admin/session', headers: { 'x-admin-request': '1' }, payload: { username: 'native_fixture_admin', password: 'fixture123' } })
  assert.equal(adminLogin.statusCode, 200, adminLogin.body)
  const cookie = adminLogin.cookies[0]!
  const adminHeaders = { 'cookie': `${cookie.name}=${cookie.value}`, 'x-admin-request': '1' }
  const updateDownloads = await app.inject({ method: 'PATCH', url: adminUrl, headers: adminHeaders, payload: { ...downloadConfig, displayName: '更新后的提示名称' } })
  assert.equal(updateDownloads.statusCode, 200, updateDownloads.body)
  assert.equal((await app.inject({ method: 'GET', url: '/api/v1/host/downloads' })).json().data.displayName, '更新后的提示名称')
  assert.equal((await app.inject({ method: 'PATCH', url: adminUrl, headers: { cookie: adminHeaders.cookie }, payload: downloadConfig })).statusCode, 403)
  await platform.identity.logout(await platform.identity.authenticate(user.token))
  await assert.rejects(sessions.authenticate(native.token), { code: 'UNAUTHENTICATED' })
  assert.equal((await invoke(native.token)).statusCode, 401)
  console.info('Native platform: market policy, Redis revisions, system bootstrap, installation denial, scoped credentials, generation fencing, write idempotence and parent logout passed.')
} finally {
  await close?.()
  if (source.isInitialized) {
    await source.destroy()
  }
  if (created) {
    await admin.query(`DROP DATABASE \`${database}\``)
  }
  await admin.end()
}
