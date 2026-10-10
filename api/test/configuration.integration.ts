/** Real MySQL and Redis; disposable configuration keys, no paid provider requests. */
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import { createClient } from 'redis'
import { createVault, hashPassword } from '../src/admin/crypto.js'
import { ConfigurationService } from '../src/admin/service.js'
import { AdminStore } from '../src/admin/store.js'
import { createApp } from '../src/app.js'
import { getConfig } from '../src/config.js'
import { ConfigurationCache } from '../src/configuration/cache.js'
import { ConfigurationStore } from '../src/configuration/store.js'
import { createDataSource } from '../src/db/data-source.js'

const source = await createDataSource().initialize()
const config = getConfig()
const redis = createClient({ ...config.redis, disableOfflineQueue: true })
redis.on('error', () => {})
const prefix = `configuration-test:${randomUUID()}`
const key = `fixture.${randomUUID()}`
const actor = randomUUID()
const cache = new ConfigurationCache(redis, prefix)
const first = new ConfigurationStore(source, cache)
const second = new ConfigurationStore(source, cache)
const definition = {
  key,
  group: '测试',
  title: '测试策略',
  description: '临时测试配置',
  type: 'number' as const,
  defaultValue: 2,
  min: 0,
  max: 5,
  effect: 'new_task' as const,
}
const administration = new ConfigurationService(
  new AdminStore(source),
  createVault(randomBytes(32)),
  cache,
)
const app = createApp({
  administration,
  bills: createBillRepository(source),
  health: async () => ({ mysql: 'up', redis: 'up' }),
})
try {
  await redis.connect()
  await source.query(
    'INSERT INTO admin_users(id,username,password_hash,enabled) VALUES(?,?,?,1)',
    [actor, `config_${actor.slice(0, 8)}`, await hashPassword('test123')],
  )
  await first.register([definition])
  await second.register([definition])
  const before = await first.snapshot()
  assert.equal(before.values[key], 2)
  assert.equal((await second.snapshot()).values[key], 2)
  await first.save(
    key,
    { revision: before.revision, value: 4, note: '发布策略' },
    actor,
  )
  assert.equal((await second.snapshot()).values[key], 4)
  assert.equal(before.values[key], 2, 'a task snapshot remains unchanged')
  await assert.rejects(
    first.save(key, { revision: before.revision, value: 1 }, actor),
    { code: 'CONFIGURATION_CHANGED' },
  )
  await assert.rejects(
    first.save(
      key,
      { revision: (await first.snapshot()).revision, value: 6 },
      actor,
    ),
    { code: 'INVALID_CONFIGURATION' },
  )
  await first.save(
    key,
    { revision: (await first.snapshot()).revision, restoreRevision: 0 },
    actor,
  )
  assert.equal((await second.snapshot()).values[key], 2)
  assert.equal((await first.history(key)).length, 3)
  // Redis loss must not hide the database or block reads.
  redis.destroy()
  assert.equal((await second.snapshot()).values[key], 2)
  assert.equal(
    (await app.inject({ url: '/api/v1/admin/configuration' })).statusCode,
    401,
  )
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/admin/session',
    headers: { 'x-admin-request': '1' },
    payload: { username: `config_${actor.slice(0, 8)}`, password: 'test123' },
  })
  assert.equal(login.statusCode, 200)
  const cookie = String(login.headers['set-cookie']).split(';')[0]!
  await administration.configuration.register([definition])
  const view = await app.inject({
    url: '/api/v1/admin/configuration',
    headers: { cookie },
  })
  assert.equal(view.statusCode, 200)
  const rev = view.json().data.revision
  assert.ok(
    view
      .json()
      .data.items.every(
        (item: { key: string }) => !item.key.startsWith('apps.'),
      ),
  )
  assert.equal(
    Number(
      (
        await source.query(
          'SELECT COUNT(*) AS count FROM platform_configurations WHERE config_key LIKE \'apps.%\'',
        )
      )[0].count,
    ),
    0,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/admin/configuration/apps.notes.tool.notes_read',
        headers: { cookie, 'x-admin-request': '1' },
        payload: { revision: rev, value: 'override' },
      })
    ).statusCode,
    404,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/configuration/${key}`,
        headers: { cookie },
        payload: { revision: rev, value: 3 },
      })
    ).statusCode,
    403,
  )
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/admin/configuration/${key}`,
        headers: { cookie, 'x-admin-request': '1' },
        payload: { revision: rev, value: 3 },
      })
    ).statusCode,
    200,
  )
  assert.equal(
    (
      await app.inject({
        url: `/api/v1/admin/configuration/${key}/history`,
        headers: { cookie },
      })
    ).json().data.length,
    4,
  )
  console.info(
    'Configuration integration passed: versioned Redis, cross-instance updates, rollback, pinned snapshot, MySQL fallback and administrator protection.',
  )
} finally {
  await app.close()
  if (!redis.isOpen) {
    await redis.connect()
  }
  let cursor = '0'
  do {
    const page = await redis.scan(cursor, { MATCH: `${prefix}:*`, COUNT: 100 })
    cursor = String(page.cursor)
    if (page.keys.length) {
      await redis.del(page.keys)
    }
  } while (cursor !== '0')
  redis.destroy()
  await source.query(
    'DELETE FROM platform_configuration_history WHERE config_key=?',
    [key],
  )
  await source.query('DELETE FROM platform_configurations WHERE config_key=?', [
    key,
  ])
  await source.query('DELETE FROM admin_sessions WHERE admin_id=?', [actor])
  await source.query('DELETE FROM admin_users WHERE id=?', [actor])
  await source.destroy()
}
