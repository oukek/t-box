import type { DataSource, EntityManager } from 'typeorm'
import type { PaymentConfiguration, WechatRuntime } from '../src/payments/configuration.js'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
/** Real MySQL regressions for repository codecs, rollback and concurrent mutations. */
import { LedgerEntity } from '@t-box/ledger-server/domain-entities'
import { LedgerAccess } from '@t-box/ledger-server/ledgers/access'
import { LedgerService } from '@t-box/ledger-server/ledgers/service'
import { jsonDocument, sqlClock, utcDate } from '@t-box/server-foundation/persistence/columns'
import { AppUserEntity, UserSessionEntity } from '@t-box/server-foundation/persistence/identity-entities'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { Raw } from 'typeorm'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { BillingService } from '../src/billing/service.js'
import { createDataSource } from '../src/db/data-source.js'
import { ApplicationInstallationEntity, ApplicationLifecycleOperationEntity } from '../src/db/records/applications-entities.js'
import { PlatformConfigurationEntity, PlatformConfigurationHistoryEntity } from '../src/db/records/configuration-entities.js'
import { PaymentOauthStateEntity, PaymentOrderEntity } from '../src/db/records/payments-entities.js'
import { IdentityService } from '../src/identity/service.js'
import { WechatAuthorization } from '../src/payments/wechat-authorization.js'
import { cleanupUsers } from './fixtures.js'
import { fixtureOss } from './oss-fixture.js'
import { paymentSelection } from './quota-fixtures.js'

if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(process.env.MYSQL_DATABASE || '')) {
  throw new Error('Disposable test database required')
}
const source = await createDataSource().initialize()
const userId = randomUUID()
const rollback = new Error('deliberate rollback')
const retry = (platform: ApplicationPlatform, id: string, token: string) =>
  (platform as unknown as { retry(id: string, token: string): Promise<void> }).retry(id, token)
async function codecs() {
  await assert.rejects(source.transaction(async (db) => {
    const clock = '2026-01-01 00:01:02.345'
    await db.getRepository(AppUserEntity).insert({ id: userId, username: `orm_${userId}`, nickname: 'Repository', passwordHash: 'not-a-real-password', createdAt: utcDate(clock) })
    const user = await db.getRepository(AppUserEntity).findOneByOrFail({ id: userId })
    assert.equal(sqlClock(user.createdAt), clock, 'legacy Date hydration preserves the UTC SQL clock')
    assert.equal(user.passwordHash, undefined, 'secrets are excluded by default')
    await db.getRepository(ResourceEntity).insert({ id: userId, user_id: userId, name: 'fixture', mime_type: 'text/plain', size: 1, source: 'uploaded', storage_backend: 'local', object_path: 'fixture', created_at: clock })
    const file = await db.getRepository(ResourceEntity).findOne({ select: { created_at: true }, where: { id: userId } })
    assert.equal(file?.created_at, clock, 'new DATETIME transformer preserves UTC milliseconds')
    for (const boundary of ['2026-03-08 02:30:00.123', '2026-11-01 01:30:00.456']) {
      await db.getRepository(AppUserEntity).update({ id: userId }, { createdAt: utcDate(boundary) })
      await db.getRepository(ResourceEntity).update({ id: userId }, { created_at: boundary })
      const old = await db.getRepository(AppUserEntity).findOneByOrFail({ id: userId })
      const current = await db.getRepository(ResourceEntity).findOneByOrFail({ id: userId })
      assert.equal(sqlClock(old.createdAt), boundary, 'UTC data cannot shift at a local DST gap or overlap')
      assert.equal(current.created_at, boundary)
    }
    const key = `fixture.orm.${userId}`
    const value = { text: '中文', nested: { a: [1, true, null] } }
    await db.getRepository(PlatformConfigurationEntity).insert({ config_key: key, definition_json: {}, value_json: jsonDocument(value), updated_at: clock })
    await db.getRepository(PlatformConfigurationHistoryEntity).insert({ config_key: key, revision: '9007199254740993', value_json: value, note: 'fixture', created_at: clock })
    const stored = await db.getRepository(PlatformConfigurationEntity).findOneByOrFail({ config_key: key })
    assert.deepEqual(stored.value_json, value, 'JSON is encoded once')
    const history = await db.getRepository(PlatformConfigurationHistoryEntity).findOneByOrFail({ config_key: key, revision: '9007199254740993' })
    assert.equal(history.revision, '9007199254740993', 'BIGINT must not lose precision')
    assert.equal(stored.updated_at, clock)
    await db.getRepository(UserSessionEntity).insert({ tokenHash: 'a'.repeat(64), userId, expiresAt: utcDate('2000-01-01 00:00:00.000') })
    const removed = await db.getRepository(UserSessionEntity).delete({ userId, expiresAt: Raw((column) => `${column} < UTC_TIMESTAMP(3)`) })
    assert.equal(removed.affected, 1, 'Raw SQL operators must preserve camelCase property mapping in DELETE')
    await assert.rejects(db.getRepository(AppUserEntity).findOneBy({ id: undefined as unknown as string }))
    await assert.rejects(db.getRepository(AppUserEntity).delete({ id: null as unknown as string }))
    throw rollback
  }), (error) => error === rollback)
  assert.equal(await source.getRepository(AppUserEntity).existsBy({ id: userId }), false, 'rollback includes prior inserts and deletes')
  assert.equal(await source.getRepository(PlatformConfigurationEntity).existsBy({ config_key: `fixture.orm.${userId}` }), false)
}
try {
  await codecs()
  if (process.env.TBOX_ORM_TZ_CHILD !== '1') {
    for (const timezone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
      execFileSync(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: timezone, TBOX_ORM_TZ_CHILD: '1' }, stdio: 'pipe' })
    }
    await source.getRepository(AppUserEntity).insert({ id: userId, username: `orm_${userId}`, nickname: '事务测试', passwordHash: 'not-a-real-password' })
    await source.getRepository(UserSessionEntity).insert({ tokenHash: 'b'.repeat(64), userId, expiresAt: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)' })
    await source.getRepository(LedgerEntity).insert(Array.from({ length: 99 }, () => ({ id: randomUUID(), name: 'quota fixture', template: 'daily' as const, ownerId: userId })))
    const identity = new IdentityService(source)
    const principal = await identity.authenticateHash('b'.repeat(64))
    const ledgers = new LedgerService(new LedgerAccess(source, identity))
    const created = await Promise.allSettled([ledgers.create(principal, { name: '并发一', template: 'daily' }), ledgers.create(principal, { name: '并发二', template: 'daily' })])
    assert.equal(created.filter((r) => r.status === 'fulfilled').length, 1, 'a waiting creator must not count books from an older transaction snapshot')
    assert.equal(await source.getRepository(LedgerEntity).countBy({ ownerId: userId }), 100)
    const oss = fixtureOss()
    const lostCommitReply = {
      getRepository: source.getRepository.bind(source),
      transaction: async (work: (db: EntityManager) => Promise<unknown>) => {
        await source.transaction(work)
        throw rollback
      },
    } as unknown as DataSource
    await assert.rejects(oss.resources(lostCommitReply).createFile({ user: { id: userId, username: 'fixture', nickname: 'fixture', createdAt: '2026-01-01T00:00:00.000Z' }, sessionHash: 'a'.repeat(64) }, 'fixture.bin', Buffer.from([0, 1, 2])), (error) => error === rollback)
    const retained = await source.getRepository(ResourceEntity).findOneByOrFail({ user_id: userId })
    assert.ok(oss.objects.has(retained.object_path), 'a lost commit reply must not delete committed object bytes')
    const operation = randomUUID()
    const token = randomUUID()
    const appId = `fixture_${randomUUID()}`
    await source.getRepository(ApplicationLifecycleOperationEntity).insert({ id: operation, user_id: userId, app_id: appId, release_id: 'fixture.1', request_key: 'retry', request_hash: 'a'.repeat(64), generation: 1, action: 'install', status: 'running', lease_token: token })
    await source.getRepository(ApplicationInstallationEntity).insert({ user_id: userId, app_id: appId, release_id: 'fixture.1', status: 'installing', grants: [], operation_id: operation, error: 'unchanged' })
    const failing = { transaction: (work: (db: EntityManager) => Promise<unknown>) => source.transaction((db) => work(new Proxy(db, { get(target, property, receiver) {
      if (property !== 'getRepository') {
        return Reflect.get(target, property, receiver)
      }
      return (entity: unknown) => {
        const repo = target.getRepository(entity as never)
        return entity === ApplicationInstallationEntity
          ? new Proxy(repo, { get(r, p, receiver) {
              return p === 'update'
                ? async () => {
                  throw rollback
                }
                : Reflect.get(r, p, receiver)
            } })
          : repo
      }
    } }))) } as unknown as DataSource
    await assert.rejects(retry(new ApplicationPlatform(failing, []), operation, token), (error) => error === rollback)
    assert.equal((await source.getRepository(ApplicationLifecycleOperationEntity).findOneByOrFail({ id: operation })).status, 'running', 'second write failure rolls the operation back')
    const platform = new ApplicationPlatform(source, [])
    await retry(platform, operation, randomUUID())
    assert.equal((await source.getRepository(ApplicationInstallationEntity).findOneByOrFail({ user_id: userId, app_id: appId })).error, 'unchanged', 'stale lease cannot update installation')
    await retry(platform, operation, token)
    assert.equal((await source.getRepository(ApplicationLifecycleOperationEntity).findOneByOrFail({ id: operation })).status, 'pending')
    assert.notEqual((await source.getRepository(ApplicationInstallationEntity).findOneByOrFail({ user_id: userId, app_id: appId })).error, 'unchanged')
    const order = randomUUID()
    const billing = new BillingService(source)
    const selection = await paymentSelection(billing)
    const product = await billing.catalog.purchaseVersion(source.manager, selection.packageId, selection.version)
    await source.getRepository(PaymentOrderEntity).insert({ id: order, user_id: userId, request_key: randomUUID(), amount_cents: 1000, package_version_id: product.id, package_snapshot: { ...product.configuration, id: selection.packageId, version: selection.version, revision: 0, publishedAt: null }, expires_at: () => 'DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 MINUTE)' })
    const oauth = new WechatAuthorization({ source } as PaymentConfiguration)
    const configuration = { id: randomUUID(), appId: 'fixture', frontendUrl: 'https://example.test', apiBaseUrl: 'https://api.example.test' } as WechatRuntime
    const started = await Promise.allSettled(Array.from({ length: 25 }, () => oauth.start(userId, order, configuration)))
    assert.equal(started.filter((r) => r.status === 'fulfilled').length, 20, 'concurrent starts share one per-user quota')
    assert.ok(started.filter((r) => r.status === 'rejected').every((r) => r.status === 'rejected' && r.reason.code === 'OAUTH_LIMIT'))
    assert.equal(await source.getRepository(PaymentOauthStateEntity).countBy({ user_id: userId }), 20)
    console.info('Repository boundaries passed: JSON/BIGINT/UTC in 3 timezones, safe WHERE, atomic rollback, stale lease fencing and concurrent ledger/OAuth quotas.')
  }
} finally {
  await cleanupUsers(source, [userId])
  await source.destroy()
}
