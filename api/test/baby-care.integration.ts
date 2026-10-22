import type { BackendInvocation } from '@t-box/app-contracts'
import type { BabyProfile } from '@t-box/baby-diary-contracts'
import type { CareInput, CarePage, CareRecord } from '@t-box/baby-diary-contracts/care'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { careInput } from '@t-box/baby-diary-contracts/care'
import { babyDiaryRelease, BabyDiaryService } from '@t-box/baby-diary-server'
import { createConnection } from 'mysql2/promise'
import { BabyCareEntity, BabyCareRevisionEntity } from '../../apps/baby-diary/server/src/care-entities.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'

const { database: _database, ...options } = getConfig().mysql
const name = `t_box_test_care_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const admin = await createConnection(options)
await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
const source = await createDataSource({ ...options, database: name }).initialize()
const service = new BabyDiaryService(source, { claim: async () => {
  assert.fail('care events must not access media implicitly')
}, list: async () => [] })
const owner = 'a'.repeat(64)
const editor = 'b'.repeat(64)
const viewer = 'c'.repeat(64)
const oldMember = 'd'.repeat(64)
async function invoke<T>(subject: string, method: string, args: unknown, key = randomUUID()) {
  const request: BackendInvocation = { appId: 'baby-diary', subject, generation: 1, releaseId: babyDiaryRelease.releaseId, invocationId: key, method, arguments: args }
  return service.invoke(request) as Promise<T>
}
async function expectCode(work: Promise<unknown>, code: string) {
  await assert.rejects(work, (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === code)
}
const bottle: CareInput = { kind: 'feeding', state: 'completed', occurredAt: '2020-01-01T08:00:00.000Z', endedAt: null, note: '', parts: [{ kind: 'bottle', milk: 'formula', amountMl: 120 }, { kind: 'bottle', milk: 'breast_milk', amountMl: null }] }
try {
  await initializeDatabase(source, databaseSchemas)
  for (const subject of [owner, editor, viewer, oldMember]) {
    await service.lifecycle({ appId: 'baby-diary', subject, generation: 1, releaseId: babyDiaryRelease.releaseId, action: 'install', operationId: randomUUID() })
  }
  const baby = await invoke<BabyProfile>(owner, 'babies_create', { baby: { name: '照护测试', birthDate: '2019-01-01', sex: 'unknown', timezone: 'Asia/Shanghai' }, displayName: '妈妈' })
  for (const [subject, role, scopes] of [[editor, 'editor', ['care']], [viewer, 'viewer', ['care']], [oldMember, 'editor', ['diary', 'growth', 'creative']]] as const) {
    const invitation = await invoke<{ token: string }>(owner, 'invites_create', { babyId: baby.id, role, scopes: [...scopes], days: 1, maxUses: 1, allowExport: false })
    await invoke(subject, 'invites_accept', { token: invitation.token, displayName: role })
  }
  await expectCode(invoke(oldMember, 'care_list', { babyId: baby.id, from: '2020-01-01', to: '2020-01-02' }), 'BABY_FORBIDDEN')
  const createKey = randomUUID()
  const batch = { babyId: baby.id, records: [bottle, { kind: 'sleep', state: 'completed', occurredAt: '2020-01-01T15:00:00.000Z', endedAt: '2020-01-01T18:00:00.000Z', note: '' }, { kind: 'diaper', state: 'completed', occurredAt: bottle.occurredAt, endedAt: null, note: '', contents: 'both' }] }
  const created = await invoke<CareRecord[]>(owner, 'care_add', batch, createKey)
  assert.deepEqual(await invoke(owner, 'care_add', batch, createKey), created)
  assert.equal(await source.getRepository(BabyCareEntity).countBy({ babyId: baby.id }), 3)
  let page = await invoke<CarePage>(viewer, 'care_list', { babyId: baby.id, from: '2020-01-01', to: '2020-01-02' })
  assert.equal(page.days[0]!.bottleMl, 120)
  assert.equal(page.days[0]!.unknownBottles, 1)
  assert.equal(page.days[0]!.changes, 1)
  assert.equal(page.days[0]!.wet, 1)
  assert.equal(page.days[0]!.dirty, 1)
  assert.equal(page.days[0]!.sleepMs, 3600_000)
  assert.equal(page.days[1]!.sleepMs, 7200_000)
  await expectCode(invoke(viewer, 'care_add', { babyId: baby.id, records: [bottle] }), 'BABY_FORBIDDEN')
  const original = created[0]!
  const edited = await invoke<CareRecord>(owner, 'care_update', { babyId: baby.id, id: original.id, revision: original.revision, record: { ...bottle, occurredAt: '2020-01-03T08:00:00.000Z', parts: [{ kind: 'bottle', milk: 'formula', amountMl: 90 }] } })
  page = await invoke<CarePage>(owner, 'care_list', { babyId: baby.id, from: '2020-01-01', to: '2020-01-03' })
  assert.equal(page.days[0]!.bottleMl, 0)
  assert.equal(page.days[2]!.bottleMl, 90)
  const historical = await source.getRepository(BabyCareRevisionEntity).findOneByOrFail({ eventId: original.id, revision: 1 })
  assert.equal((historical.snapshot as CareRecord).occurredAt, bottle.occurredAt)
  await expectCode(invoke(owner, 'care_update', { babyId: baby.id, id: original.id, revision: 1, record: bottle }), 'BABY_CONFLICT')
  await expectCode(invoke(editor, 'care_update', { babyId: baby.id, id: edited.id, revision: edited.revision, record: bottle }), 'BABY_FORBIDDEN')
  const start = new Date(Date.now() - 60_000).toISOString()
  const running: CareInput = { kind: 'sleep', state: 'running', occurredAt: start, endedAt: null, note: '' }
  const results = await Promise.allSettled([invoke<CareRecord[]>(owner, 'care_add', { babyId: baby.id, records: [running] }), invoke<CareRecord[]>(editor, 'care_add', { babyId: baby.id, records: [running] })])
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  const active = (results.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<CareRecord[]>).value[0]!
  const handoff = active.author === owner ? editor : owner
  const finishKey = randomUUID()
  const finishArgs = { babyId: baby.id, id: active.id, revision: active.revision, record: { ...careInput(active), state: 'completed', endedAt: new Date().toISOString() } }
  const finished = await invoke<CareRecord>(handoff, 'care_update', finishArgs, finishKey)
  assert.equal(finished.state, 'completed')
  assert.deepEqual(await invoke(handoff, 'care_update', finishArgs, finishKey), finished, 'handoff replay after completion must remain idempotent')
  const beforeRollback = await source.getRepository(BabyCareEntity).countBy({ babyId: baby.id })
  await expectCode(invoke(owner, 'care_add', { babyId: baby.id, records: [bottle, running, running] }), 'BABY_CARE_ACTIVE')
  assert.equal(await source.getRepository(BabyCareEntity).countBy({ babyId: baby.id }), beforeRollback, 'a failed mixed batch must commit nothing')
  const removed = await invoke<CareRecord>(owner, 'care_delete', { babyId: baby.id, id: edited.id, revision: edited.revision })
  page = await invoke<CarePage>(owner, 'care_list', { babyId: baby.id, from: '2020-01-03', to: '2020-01-03' })
  assert.equal(page.days[0]!.bottleMl, 0)
  const restored = await invoke<CareRecord>(owner, 'care_restore', { babyId: baby.id, id: removed.id, revision: removed.revision })
  assert.equal(restored.deletedAt, null)
  page = await invoke<CarePage>(owner, 'care_list', { babyId: baby.id, from: '2020-01-03', to: '2020-01-03' })
  assert.equal(page.days[0]!.bottleMl, 90)
  const breastfeeding: CareInput = { kind: 'feeding', state: 'running', occurredAt: start, endedAt: null, note: '', parts: [{ kind: 'nursing', side: 'left', startedAt: start, endedAt: null }] }
  const [nursing] = await invoke<CareRecord[]>(owner, 'care_add', { babyId: baby.id, records: [breastfeeding] })
  const paused = await invoke<CareRecord>(editor, 'care_update', { babyId: baby.id, id: nursing!.id, revision: 1, record: { ...breastfeeding, state: 'paused', parts: [{ ...breastfeeding.parts[0], endedAt: new Date().toISOString() }] } })
  assert.equal(paused.state, 'paused')
  await expectCode(invoke(owner, 'care_add', { babyId: baby.id, records: [breastfeeding] }), 'BABY_CARE_ACTIVE')
  const previousCursor = (await service.events({ appId: 'baby-diary', subject: viewer, generation: 1, releaseId: babyDiaryRelease.releaseId, channel: 'babies', arguments: { babyId: baby.id }, cursor: '' })).cursor
  await invoke(editor, 'care_add', { babyId: baby.id, records: [{ kind: 'diaper', state: 'completed', occurredAt: start, endedAt: null, note: '', contents: 'wet' }] })
  const changed = await service.events({ appId: 'baby-diary', subject: viewer, generation: 1, releaseId: babyDiaryRelease.releaseId, channel: 'babies', arguments: { babyId: baby.id }, cursor: previousCursor })
  assert.equal(changed.events.length, 1, 'care mutations notify family subscriptions')
  await invoke(owner, 'members_update', { babyId: baby.id, subject: editor, role: 'editor', scopes: ['diary'], allowExport: false })
  await expectCode(invoke(editor, 'care_add', { babyId: baby.id, records: [bottle] }), 'BABY_FORBIDDEN')
  await expectCode(invoke(editor, 'care_update', { babyId: baby.id, id: paused.id, revision: paused.revision, record: breastfeeding }), 'BABY_FORBIDDEN')
  const profile = await invoke<BabyProfile>(owner, 'babies_get', { babyId: baby.id })
  await invoke(owner, 'babies_archive', { babyId: baby.id, revision: profile.revision, archived: true })
  await expectCode(invoke(owner, 'care_add', { babyId: baby.id, records: [bottle] }), 'BABY_ARCHIVED')
  process.stdout.write('Baby care integration passed: permissions, shared handoff and replay, concurrent timers, atomic batches, midnight statistics, revisions, deletion/restore, membership revocation and family events.\n')
} finally {
  await source.destroy()
  await admin.query(`DROP DATABASE \`${name}\``)
  await admin.end()
}
