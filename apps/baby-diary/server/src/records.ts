import type {
  BabyRecord,
  BabyRecordInput,
  BabyScope,
} from '@t-box/baby-diary-contracts'
import type { EntityManager } from 'typeorm'
import type { BabyDomain } from './domain.js'
import type { StoredBabyRecord } from './entities.js'
import { randomUUID } from 'node:crypto'
import {
  BabyErrorCode,
  date,
  id,
  integer,
  mediaScope,
  object,
  parseRecord,
  scopeForRecord,
  text,
} from '@t-box/baby-diary-contracts'
import {
  Between,
  IsNull,
  LessThanOrEqual,
  MoreThanOrEqual,
  Not,
} from 'typeorm'
import { BabyRecordEntity } from './entities.js'

export const recordColumns = {
  id: true,
  babyId: true,
  kind: true,
  date: true,
  title: true,
  text: true,
  tags: true,
  assetIds: true,
  visibility: true,
  heightMm: true,
  weightGrams: true,
  headMm: true,
  method: true,
  author: true,
  authorName: true,
  revision: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} as const
export function recordDto(r: StoredBabyRecord): BabyRecord {
  const measurement =
    r.kind === 'measurement'
      ? {
          method: r.method,
          ...(r.heightMm == null ? {} : { heightMm: r.heightMm }),
          ...(r.weightGrams == null ? {} : { weightGrams: r.weightGrams }),
          ...(r.headMm == null ? {} : { headMm: r.headMm }),
        }
      : null
  return {
    id: r.id,
    babyId: r.babyId,
    kind: r.kind,
    date: r.date,
    title: r.title,
    text: r.text,
    tags: r.tags,
    assetIds: r.assetIds,
    visibility: r.visibility,
    measurement,
    author: r.author,
    authorName: r.authorName,
    revision: r.revision,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt?.toISOString() ?? null,
  }
}
const values = (input: BabyRecordInput) => ({
  kind: input.kind,
  date: input.date,
  title: input.title,
  text: input.text,
  tags: input.tags,
  assetIds: input.assetIds,
  visibility: input.visibility,
  heightMm: input.measurement?.heightMm ?? null,
  weightGrams: input.measurement?.weightGrams ?? null,
  headMm: input.measurement?.headMm ?? null,
  method: input.measurement?.method ?? ('unspecified' as const),
})
export class BabyRecords {
  constructor(readonly domain: BabyDomain) {}
  async list(subject: string, value: unknown) {
    const v = object(value, [
      'babyId',
      'kind',
      'from',
      'to',
      'query',
      'trash',
      'limit',
      'before',
    ])
    const babyId = id(v.babyId)
    const { member } = await this.domain.access.check(subject, babyId)
    const allowed: BabyScope[] = ['owner', 'admin'].includes(member.role)
      ? ['diary', 'growth', 'creative']
      : member.scopes
    const kinds = allowed.flatMap((scope) =>
      scope === 'growth'
        ? ['measurement']
        : scope === 'diary'
          ? ['diary', 'milestone']
          : [],
    )
    if (v.kind && !kinds.includes(String(v.kind))) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    const trash = v.trash === true
    if (trash && !['owner', 'admin'].includes(member.role)) {
      throw BabyErrorCode.BABY_FORBIDDEN()
    }
    const limit = v.limit == null ? 100 : integer(v.limit, '每页数量', 1, 200)
    if (!kinds.length) {
      return { records: [], next: null }
    }
    // Compound date/cursor filters and text search need a query builder; every projected column is explicit.
    const qb = this.domain.source
      .getRepository(BabyRecordEntity)
      .createQueryBuilder('r')
      .select(Object.keys(recordColumns).map((key) => `r.${key}`))
      .where('r.babyId = :babyId', { babyId })
      .andWhere('r.kind IN (:...kinds)', {
        kinds: v.kind ? [String(v.kind)] : kinds,
      })
      .andWhere(trash ? 'r.deletedAt IS NOT NULL' : 'r.deletedAt IS NULL')
    if (!['owner', 'admin'].includes(member.role)) {
      qb.andWhere('r.visibility = :visibility', { visibility: 'members' })
    }
    if (v.from) {
      qb.andWhere('r.date >= :from', { from: date(v.from) })
    }
    if (v.to) {
      qb.andWhere('r.date <= :to', { to: date(v.to) })
    }
    if (v.query) {
      qb.andWhere('(r.title LIKE :query OR r.text LIKE :query)', {
        query: `%${text(v.query, '搜索内容', 80, false).replace(/[\\%_]/g, '\\$&')}%`,
      })
    }
    if (v.before) {
      const cursor = object(v.before, ['date', 'createdAt', 'id'])
      const createdAt = new Date(String(cursor.createdAt))
      if (
        !Number.isFinite(createdAt.getTime()) ||
        createdAt.toISOString() !== cursor.createdAt
      ) {
        throw BabyErrorCode.BABY_INVALID_INPUT('游标时间无效')
      }
      qb.andWhere(
        '(r.date < :cursorDate OR (r.date = :cursorDate AND (r.createdAt < :cursorCreated OR (r.createdAt = :cursorCreated AND r.id < :cursorId))))',
        {
          cursorDate: date(cursor.date),
          cursorCreated: createdAt,
          cursorId: id(cursor.id),
        },
      )
    }
    const rows = await qb
      .orderBy('r.date', 'DESC')
      .addOrderBy('r.createdAt', 'DESC')
      .addOrderBy('r.id', 'DESC')
      .take(limit + 1)
      .getMany()
    const visible = rows.slice(0, limit)
    const last = visible.at(-1)
    return {
      records: visible.map(recordDto),
      next:
        rows.length > limit && last
          ? {
              date: last.date,
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }
          : null,
    }
  }

  async add(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'records'])
    const babyId = id(v.babyId)
    if (
      !Array.isArray(v.records) ||
      !v.records.length ||
      v.records.length > 30
    ) {
      throw BabyErrorCode.BABY_BATCH_LIMIT()
    }
    const inputs = v.records.map(parseRecord)
    return this.domain.mutate(
      subject,
      babyId,
      'records.add',
      key,
      value,
      'write',
      undefined,
      async (db) => {
        const result: BabyRecord[] = []
        for (const input of inputs) {
          const { member } = await this.domain.access.check(
            subject,
            babyId,
            'write',
            scopeForRecord(input.kind),
            input.visibility,
            db,
          )
          await this.domain.media.claim(
            db,
            subject,
            {
              type: mediaScope(scopeForRecord(input.kind), input.visibility),
              id: babyId,
            },
            input.assetIds,
          )
          const now = new Date()
          const row: StoredBabyRecord = {
            id: randomUUID(),
            babyId,
            ...values(input),
            author: subject,
            authorName: member.displayName,
            revision: 1,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          }
          await db.getRepository(BabyRecordEntity).insert(row)
          result.push(recordDto(row))
        }
        return result
      },
      async (db) => {
        for (const input of inputs) {
          await this.domain.access.check(
            subject,
            babyId,
            'write',
            scopeForRecord(input.kind),
            input.visibility,
            db,
          )
        }
      },
    )
  }

  async update(subject: string, value: unknown, key: string) {
    const v = object(value, ['babyId', 'recordId', 'revision', 'record'])
    const babyId = id(v.babyId)
    const recordId = id(v.recordId)
    const input = parseRecord(v.record)
    return this.domain.mutate(
      subject,
      babyId,
      'records.update',
      key,
      value,
      'write',
      scopeForRecord(input.kind),
      async (db) => {
        const row = await this.row(db, babyId, recordId)
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          'write',
          scopeForRecord(row.kind),
          row.visibility,
          db,
        )
        this.domain.access.canEdit(member.role, row.author, subject)
        await this.domain.access.check(
          subject,
          babyId,
          'write',
          scopeForRecord(input.kind),
          input.visibility,
          db,
        )
        this.domain.revision(row.revision, v.revision)
        if (input.kind !== row.kind || input.visibility !== row.visibility) {
          throw BabyErrorCode.BABY_INVALID_INPUT(
            '记录类型和可见范围创建后不能修改，请新建对应记录',
          )
        }
        await this.domain.media.claim(
          db,
          subject,
          {
            type: mediaScope(scopeForRecord(input.kind), input.visibility),
            id: babyId,
          },
          input.assetIds,
        )
        await db.getRepository(BabyRecordEntity).update(
          { id: recordId, babyId },
          {
            ...values(input),
            revision: row.revision + 1,
            updatedAt: new Date(),
          },
        )
        return recordDto(await this.row(db, babyId, recordId))
      },
      async (db) => {
        const row = await this.row(db, babyId, recordId)
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          'write',
          scopeForRecord(row.kind),
          row.visibility,
          db,
        )
        this.domain.access.canEdit(member.role, row.author, subject)
      },
    )
  }

  async remove(subject: string, value: unknown, key: string, restore = false) {
    const v = object(value, ['babyId', 'recordId', 'revision'])
    const babyId = id(v.babyId)
    const recordId = id(v.recordId)
    return this.domain.mutate(
      subject,
      babyId,
      restore ? 'records.restore' : 'records.delete',
      key,
      value,
      restore ? 'manage' : 'write',
      undefined,
      async (db) => {
        const row = await this.row(db, babyId, recordId, restore)
        const { member } = await this.domain.access.check(
          subject,
          babyId,
          restore ? 'manage' : 'write',
          scopeForRecord(row.kind),
          row.visibility,
          db,
        )
        this.domain.access.canEdit(member.role, row.author, subject)
        this.domain.revision(row.revision, v.revision)
        await db.getRepository(BabyRecordEntity).update(
          { id: recordId, babyId },
          {
            deletedAt: restore ? null : new Date(),
            revision: row.revision + 1,
            updatedAt: new Date(),
          },
        )
        return { id: recordId, restored: restore }
      },
    )
  }

  async row(
    db: EntityManager,
    babyId: string,
    recordId: string,
    trash = false,
  ) {
    const row = await db.getRepository(BabyRecordEntity).findOne({
      select: recordColumns,
      where: {
        id: recordId,
        babyId,
        deletedAt: trash ? Not(IsNull()) : IsNull(),
      },
    })
    if (!row) {
      throw BabyErrorCode.BABY_RECORD_NOT_FOUND()
    }
    return row
  }

  async growth(subject: string, value: unknown) {
    const v = object(value, ['babyId', 'from', 'to', 'limit'])
    const babyId = id(v.babyId)
    const { member } = await this.domain.access.check(
      subject,
      babyId,
      'read',
      'growth',
    )
    const limit = v.limit == null ? 100 : integer(v.limit, '测量数量', 1, 5000)
    const from = v.from == null ? undefined : date(v.from)
    const to = v.to == null ? undefined : date(v.to)
    if (from && to && from > to) {
      throw BabyErrorCode.BABY_INVALID_INPUT('开始日期不能晚于结束日期')
    }
    const rows = await this.domain.source.getRepository(BabyRecordEntity).find({
      select: recordColumns,
      where: {
        babyId,
        kind: 'measurement',
        ...(from && to
          ? { date: Between(from, to) }
          : from
            ? { date: MoreThanOrEqual(from) }
            : to
              ? { date: LessThanOrEqual(to) }
              : {}),
        deletedAt: IsNull(),
        ...(!['owner', 'admin'].includes(member.role)
          ? { visibility: 'members' as const }
          : {}),
      },
      order: { date: 'DESC', createdAt: 'DESC', id: 'DESC' },
      take: limit + 1,
    })
    return {
      records: rows
        .slice(0, limit)
        .reverse()
        .map((row) => ({
          id: row.id,
          date: row.date,
          measurement: recordDto(row).measurement,
          deletedAt: null,
          createdAt: row.createdAt.toISOString(),
        })),
      truncated: rows.length > limit,
    }
  }
}
