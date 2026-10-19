import type { ApplicationContext } from '@t-box/app-contracts'
import type { ConversionResult } from '@t-box/converter-contracts'
import type { DesktopSnapshot, UserSession } from '@t-box/shared'
import type { ToolContext } from '../src/agent/contracts.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createApp } from '../src/app.js'
import { createCapabilities } from '../src/bootstrap/chat.js'
import { MemorySessionRepository } from '../src/chat/session.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Unit conversion integration requires a disposable database')
}
const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const bills = createBillRepository(source)
const app = createApp({ platform, bills, health: async () => ({ mysql: 'up', redis: 'disabled' }) })
const users: string[] = []
try {
  const registration = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { username: `test_converter_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '单位换算验收' } })
  assert.equal(registration.statusCode, 201, registration.body)
  const session = registration.json<{ data: UserSession }>().data
  users.push(session.user.id)
  const headers = { 'authorization': `Bearer ${session.token}`, 'idempotency-key': randomUUID() }
  const desktop = await app.inject({ url: '/api/v1/desktop/mobile', headers })
  assert.equal(desktop.statusCode, 200, desktop.body)
  const entry = desktop.json<{ data: DesktopSnapshot }>().data.applications.find((item) => item.manifest.id === 'converter')!
  assert.ok(entry)
  assert.equal(entry.installation.kind, 'system')
  assert.equal(entry.installation.uninstallable, false)
  assert.equal(entry.aiAvailable, true)
  assert.equal(entry.manifest.version, '1.0.0')
  assert.ok(entry.manifest.iconAsset)

  for (const clientPlatform of ['web', 'android', 'ios']) {
    const response = await app.inject({ url: `/api/v1/applications/converter/context?platform=${clientPlatform}`, headers })
    assert.equal(response.statusCode, 200, response.body)
    const context = response.json<{ data: ApplicationContext }>().data
    assert.equal(context.runtime, 'web')
    assert.ok(context.capabilities.includes('api.invoke'))
    assert.ok(context.capabilities.includes('storage.get'))
    assert.equal(response.body.includes(session.token), false)
  }
  const active = await platform.applications.assertActive(session.user.id, 'converter')
  const body = { releaseId: active.release.releaseId, generation: active.installation.generation }
  const invoke = (method: string, args: unknown, authenticated = true) => app.inject({ method: 'POST', url: '/api/v1/applications/converter/invoke', headers: authenticated ? { ...headers, 'idempotency-key': randomUUID() } : { 'idempotency-key': randomUUID() }, payload: { ...body, method, arguments: args } })
  assert.equal((await invoke('catalog', {}, false)).statusCode, 401)
  const catalog = await invoke('catalog', {})
  assert.equal(catalog.statusCode, 200, catalog.body)
  assert.equal(catalog.json<{ data: unknown[] }>().data.length, 35)
  const conversion = { category: 'temperature', value: '100', from: 'degC', to: ['degF', 'K'] }
  const answer = await invoke('convert', conversion)
  assert.equal(answer.statusCode, 200, answer.body)
  assert.equal(answer.headers['cache-control'], 'no-store')
  assert.deepEqual(answer.json<{ data: ConversionResult }>().data.results.map((item) => item.value), ['212', '373.15'])
  const invalid = await invoke('convert', { ...conversion, to: ['m'] })
  assert.equal(invalid.statusCode, 400, invalid.body)
  assert.equal(invalid.json().error.code, 'CONVERTER_UNKNOWN_UNIT')
  assert.equal((await invoke('private', {})).statusCode, 403)
  const batch = await invoke('batch', { items: [conversion, { category: 'data', value: '1', from: 'MiB', to: ['B'] }] })
  assert.equal(batch.statusCode, 200, batch.body)
  assert.equal(batch.json<{ data: ConversionResult[] }>().data[1]!.results[0]!.value, '1048576')

  const uninstall = await app.inject({ method: 'POST', url: '/api/v1/app-market/converter/operations', headers, payload: { action: 'uninstall', releaseId: active.release.releaseId, grants: [] } })
  assert.equal(uninstall.statusCode, 403, uninstall.body)
  // No browser, client interaction, model request or socket is needed by these tools.
  const registry = createCapabilities({ platform, bills })
  const context: ToolContext = {
    actor: { user: session.user, sessionHash: 'test-session' },
    registry,
    skills: new Set(['unit-conversion']),
    bindings: [],
    requestId: randomUUID(),
    signal: new AbortController().signal,
    session: new MemorySessionRepository().create(),
    modulePins: {},
    interact: async () => {
      assert.fail('Conversion must not require a frontend')
    },
    use: async (_key, factory) => factory(),
  }
  await registry.requireTool('converter_convert', conversion, context)
  assert.equal((await registry.tools.converter_convert!.handler!(conversion, context) as ConversionResult).results[0]!.value, '212')
  assert.ok(context.modulePins?.converter)
  console.info('Converter integration passed: default system installation, all platforms, authentication, API/AI parity and uninstall protection')
} finally {
  await app.close()
  await cleanupUsers(source, users)
  await source.destroy()
}
