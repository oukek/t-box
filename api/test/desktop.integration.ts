import type { DesktopSnapshot } from '@t-box/shared'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createApp } from '../src/app.js'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const origin = 'http://localhost:5173'
const app = createApp({
  platform,
  bills: {} as any,
  corsOrigins: [origin],
  health: async () => ({ mysql: 'up', redis: 'disabled' }),
})
const ids: string[] = []
async function call(
  method: any,
  url: string,
  token = '',
  payload?: unknown,
  expected = 200,
) {
  const reply = await app.inject({
    method,
    url,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    ...(payload === undefined ? {} : { payload: payload as any }),
  })
  assert.equal(reply.statusCode, expected, `${method} ${url}: ${reply.body}`)
  return reply.json().data
}
try {
  const sessions = []
  for (let index = 0; index < 2; index++) {
    const session = await platform.identity.register({
      username: `test_desktop_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
      nickname: '桌面测试',
    }, 'fixture')
    ids.push(session.user.id)
    sessions.push(session)
  }
  const [a, b] = sessions
  assert.ok(a && b)
  await call('GET', '/api/v1/desktop/mobile', '', undefined, 401)
  await call('GET', '/api/v1/desktop/invalid', a.token, undefined, 400)
  const initial: DesktopSnapshot = await call(
    'GET',
    '/api/v1/desktop/mobile',
    a.token,
  )
  assert.equal(initial.revision, 0)
  assert.equal(initial.applications.length, 7)
  assert.ok(
    initial.applications.every((app) =>
      app.manifest.id === 'ledger'
        ? app.installation.kind === 'user' && app.installation.uninstallable
        : app.installation.kind === 'system' && !app.installation.uninstallable,
    ),
  )
  assert.equal(
    initial.applications.find((app) => app.manifest.id === 'profile')!
      .aiAvailable,
    false,
  )
  assert.equal(
    initial.applications.find((app) => app.manifest.id === 'calculator')!
      .aiAvailable,
    true,
  )
  const layout = {
    revision: initial.revision,
    catalogRevision: initial.catalogRevision,
    appIds: [...initial.appIds].reverse(),
  }
  const saved = await call('PUT', '/api/v1/desktop/mobile', a.token, layout)
  assert.equal(saved.revision, 1)
  assert.deepEqual(
    (await call('GET', '/api/v1/desktop/mobile', a.token)).appIds,
    layout.appIds,
  )
  assert.deepEqual(
    (await call('GET', '/api/v1/desktop/pc', a.token)).appIds,
    initial.appIds,
  )
  assert.deepEqual(
    (await call('GET', '/api/v1/desktop/mobile', b.token)).appIds,
    initial.appIds,
  )
  // Retrying after a lost successful response is idempotent, even with its old revision.
  assert.equal(
    (await call('PUT', '/api/v1/desktop/mobile', a.token, layout)).revision,
    1,
  )
  await call(
    'PUT',
    '/api/v1/desktop/mobile',
    a.token,
    { ...layout, appIds: initial.appIds },
    409,
  )
  for (const malformed of [
    { ...layout, appIds: initial.appIds.slice(1) },
    { ...layout, appIds: ['unknown', ...initial.appIds.slice(1)] },
    { ...layout, appIds: Array.from({ length: initial.appIds.length }).fill('ledger') },
    { ...layout, appIds: 'ledger' },
    { ...layout, userId: b.user.id },
    { ...layout, installation: { kind: 'user' } },
    { ...layout, revision: -1 },
  ]) {
    await call('PUT', '/api/v1/desktop/mobile', a.token, malformed, 400)
  }
  await call(
    'PUT',
    '/api/v1/desktop/mobile',
    a.token,
    { ...layout, catalogRevision: 'old' },
    409,
  )
  // Two windows saving different layouts from the same version cannot overwrite each other.
  const pc = await call('GET', '/api/v1/desktop/pc', a.token)
  const changed = [
    layout.appIds,
    [...pc.appIds.slice(2), ...pc.appIds.slice(0, 2)],
  ]
  const racing = await Promise.all(
    changed.map((appIds) =>
      app.inject({
        method: 'PUT',
        url: '/api/v1/desktop/pc',
        headers: { authorization: `Bearer ${a.token}` },
        payload: {
          revision: pc.revision,
          catalogRevision: pc.catalogRevision,
          appIds,
        },
      }),
    ),
  )
  assert.deepEqual(racing.map((reply) => reply.statusCode).sort(), [200, 409])
  assert.deepEqual(
    (await new PlatformService(source).desktop.get(a.user.id, 'mobile')).appIds,
    layout.appIds,
  )
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/desktop/mobile',
    headers: {
      origin,
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'authorization,content-type',
    },
  })
  assert.equal(preflight.statusCode, 204)
  assert.ok(
    String(preflight.headers['access-control-allow-methods']).includes('PUT'),
  )
  console.log(
    'Desktop integration passed: account/device persistence, system app protection, AI independence, version conflicts and CORS',
  )
} finally {
  await app.close()
  await cleanupUsers(source, ids)
  await source.destroy()
}
