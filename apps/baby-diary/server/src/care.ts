import type { CareInput, CarePage, CareRecord } from '@t-box/baby-diary-contracts/care'
import type { EntityManager, FindOptionsWhere } from 'typeorm'
import type { StoredCare } from './care-entities.js'
import type { BabyDomain } from './domain.js'
import { randomUUID } from 'node:crypto'
import { BabyErrorCode, date, id, integer, object } from '@t-box/baby-diary-contracts'
import { parseCare } from '@t-box/baby-diary-contracts/care'
import { careDayBounds, careDays } from '@t-box/baby-diary-core'
import { Between, In, IsNull, LessThan, MoreThanOrEqual, Not } from 'typeorm'
import { BabyCareEntity, BabyCareRevisionEntity, BabyDiaperEntity, BabyFeedingEntity } from './care-entities.js'

const columns = { id: true, babyId: true, kind: true, occurredAt: true, endedAt: true, state: true, activeSlot: true, note: true, author: true, authorName: true, revision: true, createdAt: true, updatedAt: true, deletedAt: true } as const
export class BabyCare {
  constructor(readonly domain: BabyDomain) {}

  private async dto(db: EntityManager, rows: StoredCare[]): Promise<CareRecord[]> {
    if (!rows.length) {
      return []
    }
    const ids = rows.map((row) => row.id)
    const [feeds, diapers] = await Promise.all([
      db.getRepository(BabyFeedingEntity).find({ select: { eventId: true, parts: true }, where: { eventId: In(ids) } }),
      db.getRepository(BabyDiaperEntity).find({ select: { eventId: true, contents: true }, where: { eventId: In(ids) } }),
    ])
    const feedingById = new Map(feeds.map((feed) => [feed.eventId, feed]))
    const diaperById = new Map(diapers.map((diaper) => [diaper.eventId, diaper]))
    return rows.map((row) => {
      const base = { id: row.id, babyId: row.babyId, occurredAt: row.occurredAt.toISOString(), endedAt: row.endedAt?.toISOString() ?? null, state: row.state, note: row.note, author: row.author, authorName: row.authorName, revision: row.revision, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), deletedAt: row.deletedAt?.toISOString() ?? null }
      if (row.kind === 'feeding') {
        const detail = feedingById.get(row.id)
        if (!detail) {
          throw BabyErrorCode.BABY_CARE_NOT_FOUND('喂养记录不完整，请联系管理员核对')
        }
        return { ...base, kind: 'feeding', parts: detail.parts }
      }
      if (row.kind === 'diaper') {
        const detail = diaperById.get(row.id)
        if (!detail) {
          throw BabyErrorCode.BABY_CARE_NOT_FOUND('尿布记录不完整，请联系管理员核对')
        }
        return { ...base, kind: 'diaper', contents: detail.contents }
      }
      return { ...base, kind: 'sleep' }
    })
  }

  async list(subject: string, value: unknown): Promise<CarePage> {
    const v = object(value, ['babyId', 'from', 'to'])
    const babyId = id(v.babyId)
    const from = date(v.from)
    const to = date(v.to)
    if (from > to || Date.parse(to) - Date.parse(from) > 30 * 86400_000) {
      throw BabyErrorCode.BABY_INVALID_INPUT('每次最多查看 31 天，请核对日期范围')
    }
    // One snapshot makes the header, details and permission check coherent during shared edits.
    return this.domain.source.transaction('REPEATABLE READ', async (db) => {
      const { baby } = await this.domain.access.check(subject, babyId, 'read', 'care', 'members', db)
      const start = new Date(careDayBounds(from, baby.timezone).start)
      const end = new Date(careDayBounds(to, baby.timezone).end)
      const common: FindOptionsWhere<StoredCare> = { babyId, deletedAt: IsNull(), occurredAt: LessThan(end) }
      const rows = await db.getRepository(BabyCareEntity).find({
        select: columns,
        where: [
          { ...common, occurredAt: Between(start, new Date(end.valueOf() - 1)) },
          { ...common, endedAt: MoreThanOrEqual(start) },
          { ...common, activeSlot: Not(IsNull()) },
        ],
        order: { occurredAt: 'DESC', id: 'DESC' },
        take: 10001,
      })
      if (rows.length > 10000) {
        throw BabyErrorCode.BABY_CARE_RANGE()
      }
      const latest = await Promise.all((['feeding', 'sleep', 'diaper'] as const).map((kind) => db.getRepository(BabyCareEntity).findOne({ select: columns, where: { babyId, kind, deletedAt: IsNull() }, order: { occurredAt: 'DESC', id: 'DESC' } })))
      const visible = [...rows, ...latest.filter((row): row is StoredCare => !!row && !rows.some((existing) => existing.id === row.id))]
      visible.sort((a, b) => b.occurredAt.valueOf() - a.occurredAt.valueOf())
      const records = await this.dto(db, visible)
      const asOf = new Date().toISOString()
      return { records, active: records.filter((row) => row.state !== 'completed'), days: careDays(records, from, to, baby.timezone, Date.parse(asOf)), timezone: baby.timezone, asOf }
    })
  }

  private async available(db: EntityManager, babyId: string, input: CareInput, except?: string) {
    if (input.state === 'completed') {
      return
    }
    const current = await db.getRepository(BabyCareEntity).findOne({ select: { id: true }, where: { babyId, activeSlot: input.kind } })
    if (current && current.id !== except) {
      throw BabyErrorCode.BABY_CARE_ACTIVE()
    }
  }

  private async write(db: EntityManager, row: StoredCare, input: CareInput) {
    await this.available(db, row.babyId, input, row.id)
    const value: StoredCare = { ...row, kind: input.kind, occurredAt: new Date(input.occurredAt), endedAt: input.endedAt ? new Date(input.endedAt) : null, state: input.state, note: input.note, activeSlot: row.deletedAt || input.state === 'completed' ? null : input.kind }
    await db.getRepository(BabyCareEntity).save(value)
    if (input.kind === 'feeding') {
      await db.getRepository(BabyFeedingEntity).save({ eventId: row.id, parts: input.parts })
    } else if (input.kind === 'diaper') {
      await db.getRepository(BabyDiaperEntity).save({ eventId: row.id, contents: input.contents })
    }
    return (await this.dto(db, [value]))[0]!
  }

  async add(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'records'])
    const babyId = id(v.babyId)
    if (!Array.isArray(v.records) || !v.records.length || v.records.length > 30) {
      throw BabyErrorCode.BABY_BATCH_LIMIT()
    }
    const inputs = v.records.map((row) => parseCare(row))
    return this.domain.mutate(subject, babyId, 'care.add', key, value, 'write', 'care', async (db) => {
      const { member } = await this.domain.access.check(subject, babyId, 'write', 'care', 'members', db)
      const result: CareRecord[] = []
      for (const input of inputs) {
        const now = new Date()
        result.push(await this.write(db, { id: randomUUID(), babyId, kind: input.kind, occurredAt: now, endedAt: null, state: input.state, activeSlot: null, note: '', author: subject, authorName: member.displayName, revision: 1, createdAt: now, updatedAt: now, deletedAt: null }, input))
      }
      return result
    })
  }

  async change(subject: string, value: unknown, key: string, action: 'update' | 'delete' | 'restore') {
    const v = object(value, ['babyId', 'id', 'revision', ...(action === 'update' ? ['record'] : [])])
    const babyId = id(v.babyId)
    const eventId = id(v.id)
    const revision = integer(v.revision, '版本', 1, 2147483646)
    const input = action === 'update' ? parseCare(v.record) : undefined
    const authorize = async (db: EntityManager, editing = false) => {
      const row = await db.getRepository(BabyCareEntity).findOne({ select: columns, where: { id: eventId, babyId } })
      if (!row) {
        throw BabyErrorCode.BABY_CARE_NOT_FOUND()
      }
      const { member } = await this.domain.access.check(subject, babyId, 'write', 'care', 'members', db)
      // Shared active timers may be handed off to any authorized recorder. Completed records retain author restrictions.
      if (editing && (row.state === 'completed' || row.deletedAt || action !== 'update')) {
        this.domain.access.canEdit(member.role, row.author, subject)
      }
      return row
    }
    return this.domain.mutate(subject, babyId, `care.${action}`, key, value, 'write', 'care', async (db) => {
      const row = await authorize(db, true)
      this.domain.revision(row.revision, revision)
      if ((action === 'restore') !== !!row.deletedAt) {
        throw BabyErrorCode.BABY_CONFLICT('记录状态已变化，请刷新后重试')
      }
      const before = (await this.dto(db, [row]))[0]!
      await db.getRepository(BabyCareRevisionEntity).insert({ eventId, revision, actor: subject, snapshot: before, createdAt: new Date() })
      row.revision++
      row.updatedAt = new Date()
      if (action === 'update' && input) {
        if (input.kind !== row.kind) {
          throw BabyErrorCode.BABY_INVALID_INPUT('不能更改记录类型，请另建记录')
        }
        return this.write(db, row, input)
      }
      row.deletedAt = action === 'delete' ? new Date() : null
      row.activeSlot = row.deletedAt || row.state === 'completed' ? null : row.kind
      if (row.activeSlot) {
        await this.available(db, babyId, before, row.id)
      }
      await db.getRepository(BabyCareEntity).save(row)
      return (await this.dto(db, [row]))[0]!
    }, async (db) => {
      await authorize(db)
    })
  }
}
