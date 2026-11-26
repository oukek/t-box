import type { DataSource, EntityManager } from 'typeorm'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { IdentityService } from '../src/identity/service.js'
import { sessionDevice } from '../src/identity/session-policy.js'

test('session issuance distinguishes Mac browsers, installed PWA, Mac app and collector', async () => {
  const rows: any[] = []
  const db = { getRepository: () => ({ insert: async (row: unknown) => rows.push(row) }) } as unknown as EntityManager
  const identity = new IdentityService({} as DataSource)
  for (const [device, client, days] of [
    ['Mac · Safari', 'web', 7],
    ['Mac · Chrome', 'pwa', 30],
    ['Mac · Safari', 'mac', 30],
    ['T方舟采集插件 · Mac 快捷登录', undefined, 7],
    ['浏览器', 'invalid', 7],
  ] as const) {
    await identity.session(db, { id: 'user', username: 'test', nickname: 'test', createdAt: new Date().toISOString() }, sessionDevice(device, client))
    assert.match(rows.at(-1).expiresAt(), new RegExp(`INTERVAL ${days} DAY`))
  }
})

test('activity renews only valid sessions, throttles writes and retries failed writes', async () => {
  let valid = true
  let writes = 0
  let fail = false
  const conditions: string[] = []
  let patch: Record<string, () => string> = {}
  const query = {
    select() {
      return this
    },
    from() {
      return this
    },
    innerJoin() {
      return this
    },
    leftJoin() {
      return this
    },
    where(sql: string) {
      conditions.push(sql)
      return this
    },
    setParameters() {
      return this
    },
    getRawMany: async () => valid ? [{ id: 'user', createdAt: new Date() }] : [],
    update() {
      return this
    },
    set(value: typeof patch) {
      patch = value
      return this
    },
    updateEntity() {
      return this
    },
    async execute() {
      writes++
      if (fail) {
        throw new Error('database unavailable')
      }
    },
  }
  const manager = { createQueryBuilder: () => query } as unknown as EntityManager
  const identity = new IdentityService({ manager } as DataSource, undefined, 'internal')
  await identity.authenticateHash('web')
  assert.equal(writes, 1)
  assert.match(patch.expiresAt!(), /GREATEST/)
  assert.match(patch.expiresAt!(), /THEN 30 ELSE 7/)
  assert.match(patch.expiresAt!(), /快捷指令.*THEN expires_at/)
  assert.ok(conditions.some((sql) => sql.includes('token_hash=:p0 AND expires_at>UTC_TIMESTAMP(3)')))
  await identity.authenticateHash('web')
  assert.equal(writes, 1)
  valid = false
  await assert.rejects(identity.authenticateHash('expired'))
  assert.equal(writes, 1)
  valid = true
  fail = true
  await assert.rejects(identity.authenticateHash('retry'))
  fail = false
  await identity.authenticateHash('retry')
  assert.equal(writes, 3)
  await identity.current('a'.repeat(64), 'mac')
  assert.match(patch.device!(), /Mac 版/)
  assert.match(patch.expiresAt!(), /INTERVAL 30 DAY/)
  assert.ok(conditions.some(sql => sql.includes("device NOT LIKE 'T方舟采集插件%'")))
  const beforeExpired = writes
  valid = false
  await assert.rejects(identity.current('b'.repeat(64), 'mac'))
  assert.equal(writes, beforeExpired)
})
