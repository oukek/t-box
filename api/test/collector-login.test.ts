import type { DataSource, EntityManager } from 'typeorm'
import type { IdentityService } from '../src/identity/service.js'
import type { WechatAccountConfiguration } from '../src/identity/wechat-configuration.js'
import type { WechatFlowRow } from '../src/identity/wechat-entities.js'
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { AppUserEntity, UserSessionEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { createVault, digest } from '../src/admin/crypto.js'
import { WechatFlowEntity } from '../src/identity/wechat-entities.js'
import { collectorDevice, WechatLoginService } from '../src/identity/wechat-login.js'

function fixture() {
  const secret = randomBytes(32).toString('hex')
  const user = { id: randomUUID(), username: 'fixture', nickname: '插件用户', enabled: true, createdAt: new Date() }
  const row = { id: randomUUID(), secretHash: digest(secret), kind: 'qr', device: collectorDevice, status: 'pending', appId: 'fixture', expiresAt: new Date(Date.now() + 60_000), userId: null, sessionCipher: null } as WechatFlowRow
  const tokens = new Map<string, string>([['website', user.id]])
  let issued = 0
  const flows = {
    async findOne(options: { where: { id: string, secretHash: string } }) {
      return options.where.id === row.id && options.where.secretHash === row.secretHash ? { ...row } : null
    },
    async findOneBy() {
      return null
    },
    async update(_where: unknown, changes: Partial<WechatFlowRow>) {
      Object.assign(row, changes)
    },
  }
  const manager = {
    getRepository(entity: unknown) {
      if (entity === WechatFlowEntity) {
        return flows
      }
      if (entity === AppUserEntity) {
        return { findOneBy: async () => user }
      }
      if (entity === UserSessionEntity) {
        return { delete: async ({ tokenHash }: { tokenHash: string }) => {
          for (const token of tokens.keys()) {
            if (digest(token) === tokenHash) {
              tokens.delete(token)
            }
          }
        } }
      }
      return { findOneBy: async () => null }
    },
  } as unknown as EntityManager
  let queue = Promise.resolve<unknown>(undefined)
  const source = { manager, getRepository: manager.getRepository.bind(manager), transaction<T>(job: (db: EntityManager) => Promise<T>) {
    const next = queue.then(() => job(manager))
    queue = next.catch(() => {})
    return next
  } } as unknown as DataSource
  const identity = {
    async authenticate(token: string) {
      if (!tokens.has(token)) {
        throw new Error('invalid token')
      }
      return { user }
    },
    async session() {
      issued++
      const token = randomBytes(32).toString('hex')
      tokens.set(token, user.id)
      return { token, user }
    },
  } as unknown as IdentityService
  const configuration = { source, vault: createVault(randomBytes(32)), runtime: async () => ({ enabled: true, appId: 'fixture', appSecret: 'secret' }) } as unknown as WechatAccountConfiguration
  const service = new WechatLoginService(configuration, identity)
  return { service, row, tokens, user, issued: () => issued, proof: { id: row.id, secret } }
}

test('quick login issues a separate session, hides it from polling and redeems once', async () => {
  const f = fixture()
  await f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website')
  assert.equal(f.issued(), 1)
  assert.equal((await f.service.poll(f.proof)).session, undefined)
  const session = await f.service.redeemCollector(f.proof)
  assert.notEqual(session.token, 'website')
  assert.equal(session.user.id, f.user.id)
  assert.equal(f.tokens.has('website'), true)
  await assert.rejects(f.service.redeemCollector(f.proof))
})

test('rejects wrong proof, stale account, expired and non-collector flows without issuing sessions', async () => {
  const f = fixture()
  await assert.rejects(f.service.approveCollector({ ...f.proof, secret: '0'.repeat(64), userId: f.user.id }, 'website'))
  await assert.rejects(f.service.approveCollector({ ...f.proof, userId: randomUUID() }, 'website'))
  await assert.rejects(f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'invalid'))
  f.row.device = 'Mac · Chrome'
  await assert.rejects(f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website'))
  f.row.device = collectorDevice
  f.row.expiresAt = new Date(0)
  await assert.rejects(f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website'))
  assert.equal(f.issued(), 0)
})

test('duplicate approval and concurrent redemption cannot create or redeem two sessions', async () => {
  const f = fixture()
  const approvals = await Promise.allSettled([1, 2].map(() => f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website')))
  assert.equal(approvals.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(f.issued(), 1)
  const redeemed = await Promise.allSettled([1, 2].map(() => f.service.redeemCollector(f.proof)))
  assert.equal(redeemed.filter((r) => r.status === 'fulfilled').length, 1)
})

test('closing an approved but unredeemed flow revokes only its new session', async () => {
  const f = fixture()
  await f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website')
  assert.equal(f.tokens.size, 2)
  await f.service.cancel(f.proof)
  assert.equal(f.tokens.size, 1)
  assert.equal(f.tokens.has('website'), true)
  await assert.rejects(f.service.redeemCollector(f.proof))
})

test('closing a redeemed flow leaves its accepted session valid', async () => {
  const f = fixture()
  await f.service.approveCollector({ ...f.proof, userId: f.user.id }, 'website')
  const session = await f.service.redeemCollector(f.proof)
  await f.service.cancel(f.proof)
  assert.equal(f.tokens.has(session.token), true)
})
