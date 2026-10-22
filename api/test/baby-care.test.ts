import type { CareInput, CareRecord } from '@t-box/baby-diary-contracts/care'
import type { CareCommand, CareSnapshot } from '../../apps/baby-diary/core/src/care-outbox.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCare } from '@t-box/baby-diary-contracts/care'
import { CareOutbox, carePreview, emptyCareSnapshot } from '../../apps/baby-diary/core/src/care-outbox.js'
import { careDayBounds, careDays } from '../../apps/baby-diary/core/src/care.js'

const at = '2020-01-01T15:00:00.000Z'
const make = (input: CareInput, id = 'local-record'): CareRecord => ({ ...input, id, babyId: 'baby', author: 'subject', authorName: '家人', revision: 1, createdAt: at, updatedAt: at, deletedAt: null })
const bottle: CareInput = { kind: 'feeding', occurredAt: at, endedAt: null, note: '', state: 'completed', parts: [{ kind: 'bottle', milk: 'formula', amountMl: 100 }, { kind: 'bottle', milk: 'breast_milk', amountMl: null }] }

test('care strictly separates unknown milk volume, nursing time, sleep and diaper types', () => {
  assert.deepEqual(parseCare(bottle), bottle)
  for (const amountMl of [-1, 0, 1.2, '', Number.NaN, '120']) {
    assert.throws(() => parseCare({ ...bottle, parts: [{ kind: 'bottle', milk: 'formula', amountMl }] }))
  }
  assert.throws(() => parseCare({ ...bottle, occurredAt: '2020-02-30T00:00:00Z' }))
  assert.throws(() => parseCare({ ...bottle, parts: [{ kind: 'bottle', milk: 'formula', amountMl: 10, side: 'left' }] }))
  assert.throws(() => parseCare({ kind: 'sleep', state: 'completed', occurredAt: at, endedAt: null, note: '' }))
  const feed = { kind: 'feeding', occurredAt: at, endedAt: '2020-01-01T16:00:00.000Z', state: 'completed', note: '', parts: [{ kind: 'nursing', side: 'left', startedAt: at, endedAt: '2020-01-01T15:10:00.000Z' }, { kind: 'nursing', side: 'right', startedAt: '2020-01-01T15:20:00.000Z', endedAt: '2020-01-01T15:30:00.000Z' }] }
  assert.equal(parseCare(feed).kind, 'feeding')
  assert.throws(() => parseCare({ ...feed, parts: [feed.parts[0], { ...feed.parts[1], startedAt: '2020-01-01T15:05:00.000Z' }] }))
  const [day] = careDays([make(parseCare(feed)), make(bottle, 'bottle'), make({ kind: 'diaper', occurredAt: at, endedAt: null, state: 'completed', note: '', contents: 'both' }, 'diaper')], '2020-01-01', '2020-01-01', 'Asia/Shanghai')
  assert.equal(day!.feedings, 2, 'switching sides must remain one feeding')
  assert.equal(day!.nursingMs, 20 * 60_000, 'paused gaps are not nursing time')
  assert.equal(day!.bottleMl, 100)
  assert.equal(day!.unknownBottles, 1)
  assert.equal(day!.changes, 1)
  assert.equal(day!.wet, 1)
  assert.equal(day!.dirty, 1)
})
test('sleep splits at local midnight, unions overlapping sessions, and handles daylight saving days', () => {
  const sleep = make({ kind: 'sleep', state: 'completed', occurredAt: at, endedAt: '2020-01-01T18:00:00.000Z', note: '' })
  const days = careDays([sleep, { ...sleep, id: 'duplicate' }], '2020-01-01', '2020-01-02', 'Asia/Shanghai')
  assert.equal(days[0]!.sleepMs, 3600_000)
  assert.equal(days[1]!.sleepMs, 7200_000)
  assert.equal(careDayBounds('2026-03-08', 'America/New_York').end - careDayBounds('2026-03-08', 'America/New_York').start, 23 * 3600_000)
  assert.equal(careDayBounds('2026-11-01', 'America/New_York').end - careDayBounds('2026-11-01', 'America/New_York').start, 25 * 3600_000)
  assert.equal(careDays([{ ...sleep, deletedAt: at }], '2020-01-01', '2020-01-01', 'UTC')[0]!.sleepMs, 0)
})
test('outbox survives an unknown write outcome and remaps dependent local timer edits without duplicating writes', async () => {
  let saved = emptyCareSnapshot()
  const receipts = new Map<string, CareRecord | CareRecord[]>()
  const remote = new Map<string, CareRecord>()
  const keys: string[] = []
  let loseResponse = true
  const port = {
    babyId: 'baby',
    subject: 'subject',
    name: '家人',
    save: async (value: CareSnapshot) => {
      saved = structuredClone(value)
    },
    changed: (_value: CareSnapshot) => {},
    invoke: async (method: string, input: unknown, key: string) => {
      keys.push(key)
      if (receipts.has(key)) {
        return receipts.get(key)!
      }
      const args = input as { id?: string, revision?: number, records?: CareInput[], record?: CareInput }
      const result = method === 'care_add' ? [make(args.records![0]!, 'server-record')] : { ...remote.get(args.id!)!, ...args.record!, revision: args.revision! + 1 }
      remote.set('server-record', Array.isArray(result) ? result[0]! : result)
      receipts.set(key, result)
      if (loseResponse) {
        loseResponse = false
        throw new Error('connection lost after commit')
      }
      return result
    },
  }
  const first = new CareOutbox(port)
  await first.enqueue({ key: 'stable-add', target: 'local-timer', revision: 0, action: 'add', record: bottle, at })
  await assert.rejects(first.flush())
  first.close()
  assert.equal(saved.pending.length, 1)
  const reloaded = new CareOutbox(port, saved)
  await reloaded.enqueue({ key: 'stable-edit', target: 'local-timer', revision: 1, action: 'update', record: { ...bottle, note: '修正' }, at })
  await reloaded.flush()
  assert.deepEqual(keys, ['stable-add', 'stable-add', 'stable-edit'])
  assert.equal(remote.size, 1)
  assert.equal(remote.get('server-record')!.revision, 2)
  assert.equal(remote.get('server-record')!.note, '修正')
  assert.equal(saved.pending.length, 0)
  assert.equal(saved.records[0]!.id, 'server-record')
})
test('conflicts pause synchronization; discarding a conflicted edit also drops dependent edits', async () => {
  let saved = emptyCareSnapshot()
  let calls = 0
  const store = new CareOutbox({ babyId: 'baby', subject: 'subject', name: '家人', save: async (value) => {
    saved = value
  }, changed: () => {}, invoke: async () => {
    calls++
    throw Object.assign(new Error('版本冲突'), { status: 409 })
  } })
  const command: CareCommand = { key: 'first', target: 'same', revision: 1, action: 'update', record: bottle, at }
  await store.enqueue(command)
  await store.enqueue({ ...command, key: 'second', revision: 2 })
  await assert.rejects(store.flush())
  assert.equal(saved.pending[0]!.error, '版本冲突')
  await store.flush()
  assert.equal(calls, 1)
  await store.discard('first')
  assert.equal(saved.pending.length, 0)
})
test('offline previews retain running timers across reloads and keep unknown bottles explicit', () => {
  const command: CareCommand = { key: 'pending', target: 'pending', revision: 0, action: 'add', record: { kind: 'sleep', state: 'running', occurredAt: at, endedAt: null, note: '' }, at }
  const snapshot = { ...emptyCareSnapshot(), pending: [command] }
  const records = carePreview(structuredClone(snapshot), 'baby', 'subject', '家人')
  assert.equal(records[0]!.occurredAt, at)
  assert.equal(records[0]!.state, 'running')
  const now = Date.parse(at) + 123_000
  assert.equal(careDays(records, '2020-01-01', '2020-01-01', 'UTC', now)[0]!.sleepMs, 123_000)
})

test('a supplementary bottle after midnight contributes volume to its actual day without inventing a second feeding', () => {
  const record = make(parseCare({ kind: 'feeding', state: 'completed', occurredAt: at, endedAt: '2020-01-01T17:00:00.000Z', note: '', parts: [{ kind: 'nursing', side: 'left', startedAt: at, endedAt: '2020-01-01T16:10:00.000Z' }, { kind: 'bottle', milk: 'formula', amountMl: 30, occurredAt: '2020-01-01T16:15:00.000Z' }] }))
  const days = careDays([record], '2020-01-01', '2020-01-02', 'Asia/Shanghai')
  assert.equal(days[0]!.feedings, 1)
  assert.equal(days[1]!.feedings, 0)
  assert.equal(days[0]!.bottleMl, 0)
  assert.equal(days[1]!.bottleMl, 30)
})

test('one conflicted record does not block synchronization of unrelated care entries', async () => {
  let saved = emptyCareSnapshot()
  const completed: string[] = []
  const store = new CareOutbox({ babyId: 'baby', subject: 'subject', name: '家人', save: async (value) => {
    saved = value
  }, changed: () => {}, invoke: async (_method, _args, key) => {
    if (key === 'conflict') {
      throw Object.assign(new Error('记录已变化'), { status: 409 })
    }
    completed.push(key)
    return [make(bottle, 'confirmed')]
  } })
  await store.enqueue({ key: 'conflict', action: 'update', target: 'old', revision: 1, record: bottle, at })
  await store.enqueue({ key: 'new-entry', action: 'add', target: 'new', revision: 0, record: bottle, at })
  await assert.rejects(store.flush())
  assert.deepEqual(completed, ['new-entry'])
  assert.equal(saved.pending.length, 1)
  assert.equal(saved.pending[0]!.key, 'conflict')
})

test('cache eviction reserves local storage for unsynchronized commands without dropping pending work', async () => {
  let state = { ...emptyCareSnapshot(), asOf: at, records: Array.from({ length: 65 }, (_, index) => make({ ...bottle, note: '字'.repeat(500) }, `cached-${index}`)) }
  const originalCount = state.records.length
  const store = new CareOutbox({ babyId: 'baby', subject: 'subject', name: '家人', save: async (value) => {
    state = value
  }, changed: () => {}, invoke: async () => [] }, state)
  for (let index = 0; index < 15; index++) {
    await store.enqueue({ key: `new-${index}`, target: `new-${index}`, action: 'add', revision: 0, at, record: { ...bottle, note: '字'.repeat(500) } })
  }
  assert.equal(state.pending.length, 15)
  assert.ok(state.records.length < originalCount)
  assert.ok(JSON.stringify(state).length <= 60_000)
  assert.equal(state.asOf, '', 'evicted cache must not pretend to cover the whole date range')
})
