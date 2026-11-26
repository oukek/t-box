import type { DataSource, EntityManager } from 'typeorm'
import type { IdentityService } from '../src/identity/service.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { digest } from '../src/admin/crypto.js'
import { LoginHandoffService } from '../src/identity/login-handoff.js'

function fixture() {
  interface Row { id: string, secretHash: string, target: string, expiresAt: Date, sourceHash?: string | null, userId?: string, consumed: boolean }
  const rows = new Map<string, Row>()
  const user = { id: randomUUID(), nickname: 'Mac 用户' }
  const tokens = new Map([['mac-token', user.id]])
  const labels: string[] = []
  const repository = {
    async delete() {},
    async insert(row: Row) {
      rows.set(row.id, { ...row, consumed: false })
    },
    async findOne(input: { where: { id: string, secretHash: string }, lock: { mode: string } }) {
      assert.equal(input.lock.mode, 'pessimistic_write')
      const row = rows.get(input.where.id)
      return row?.secretHash === input.where.secretHash ? { ...row } : null
    },
    async update(where: { id: string }, patch: Partial<Row>) {
      Object.assign(rows.get(where.id)!, patch)
    },
  }
  const manager = { getRepository: () => repository } as unknown as EntityManager
  let queue = Promise.resolve<unknown>(undefined)
  const source = { getRepository: () => repository, transaction<T>(job: (db: EntityManager) => Promise<T>) {
    const next = queue.then(() => job(manager))
    queue = next.catch(() => {})
    return next
  } } as unknown as DataSource
  const identity = {
    limit() {},
    async authenticate(token: string) {
      assert.equal(tokens.get(token), user.id, 'Source session must be valid')
      return { user, sessionHash: digest(token) }
    },
    async authenticateHash(hash: string) {
      assert.equal([...tokens.keys()].some((token) => digest(token) === hash), true, 'Source session must still be valid')
      return { user, sessionHash: hash }
    },
    async session(_db: EntityManager, _user: unknown, label: string) {
      labels.push(label)
      const token = randomUUID()
      tokens.set(token, user.id)
      return { token, user }
    },
  } as unknown as IdentityService
  const service = new LoginHandoffService(source, identity)
  async function start(target = 'browser') {
    const secret = 'a'.repeat(64)
    const flow = await service.start({ secret, target }, 'fixture')
    return { id: flow.id, secret, target, userId: user.id }
  }
  return { service, rows, tokens, labels, user, start }
}

test('browser and collector receive independent sessions without changing the Mac session', async () => {
  const f = fixture()
  for (const target of ['browser', 'collector']) {
    const proof = await f.start(target)
    await f.service.approve(proof, 'mac-token')
    assert.equal(f.tokens.size, target === 'browser' ? 1 : 2, 'Approval does not create an unclaimed session')
    const session = await f.service.redeem(proof)
    assert.notEqual(session.token, 'mac-token')
    assert.equal(session.user.id, f.user.id)
    await assert.rejects(f.service.redeem(proof))
  }
  assert.equal(f.tokens.has('mac-token'), true)
  assert.deepEqual(f.labels, ['浏览器 · Mac 快捷登录', 'T方舟采集插件 · Mac 快捷登录'])
})

test('wrong proof, target or account cannot authorize a handoff', async () => {
  const f = fixture()
  const proof = await f.start()
  await assert.rejects(f.service.approve({ ...proof, secret: 'b'.repeat(64) }, 'mac-token'))
  await assert.rejects(f.service.approve({ ...proof, target: 'collector' }, 'mac-token'))
  await assert.rejects(f.service.approve({ ...proof, userId: randomUUID() }, 'mac-token'))
  await assert.rejects(f.service.redeem(proof))
  assert.equal(f.tokens.size, 1)
})

test('source logout, expiry and recipient account mismatch prevent redemption', async () => {
  const f = fixture()
  const proof = await f.start()
  await f.service.approve(proof, 'mac-token')
  await assert.rejects(f.service.redeem({ ...proof, userId: randomUUID() }))
  await assert.rejects(f.service.redeem({ ...proof, target: 'collector' }))
  f.tokens.delete('mac-token')
  await assert.rejects(f.service.redeem(proof))
  f.tokens.set('mac-token', f.user.id)
  f.rows.get(proof.id)!.expiresAt = new Date(0)
  await assert.rejects(f.service.redeem(proof))
  assert.equal(f.labels.length, 0)
})

test('parallel redemption and approval are serialized and cannot issue two sessions', async () => {
  const f = fixture()
  const proof = await f.start()
  const approvals = await Promise.allSettled([1, 2].map(() => f.service.approve(proof, 'mac-token')))
  assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1)
  const redemptions = await Promise.allSettled([1, 2].map(() => f.service.redeem(proof)))
  assert.equal(redemptions.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.tokens.size, 2)
})
