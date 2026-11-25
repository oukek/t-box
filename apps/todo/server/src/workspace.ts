import type { LifecycleRequest } from '@t-box/app-contracts'
import type { ApplicationBackend } from '@t-box/app-server-sdk'
import type { DataSource } from 'typeorm'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import {
  localDay,
  occurs,
  shift,
  TodoError,
  validate,
} from '@t-box/todo-contracts'
import { MoreThan } from 'typeorm'
import { Entry, Owner, Receipt } from './entities.js'

export class TodoService {
  constructor(private readonly source: DataSource) {}
  private async lifecycle(r: LifecycleRequest, statusOnly: boolean) {
    const { subject, generation, releaseId } = r
    const key = fingerprint(['install', r.operationId])
    const hash = fingerprint(r)
    return this.source.transaction(async (db) => {
      if (!statusOnly) {
        await db
          .createQueryBuilder()
          .insert()
          .into(Owner)
          .values({ subject, generation: 0, releaseId: '', active: false })
          .orIgnore()
          .execute()
      }
      const owner = await db.findOne(Owner, {
        where: { subject },
        lock: { mode: 'pessimistic_write' },
      })
      const prior = await db.findOneBy(Receipt, { subject, key })
      if (prior) {
        if (prior.hash !== hash) {
          throw TodoError.TODO_CONFLICT()
        }
        return { status: 'completed' as const, receipt: prior.response }
      }
      if (statusOnly) {
        return null
      }
      if (
        !owner ||
        generation < owner.generation ||
        (generation > owner.generation && r.action !== 'install') ||
        (generation === owner.generation &&
          (!owner.active ||
            (owner.releaseId !== releaseId && r.action !== 'update')))
      ) {
        throw TodoError.TODO_INSTALLATION()
      }
      await db.update(
        Owner,
        { subject },
        { generation, releaseId, active: r.action !== 'uninstall' },
      )
      const response = { appId: r.appId, generation, action: r.action }
      await db.insert(Receipt, { subject, key, hash, response })
      return { status: 'completed' as const, receipt: response }
    })
  }

  backend(): ApplicationBackend {
    return {
      lifecycle: async (r) => (await this.lifecycle(r, false))!,
      operation: (r) => this.lifecycle(r, true),
      invoke: (r) =>
        this.source.transaction(async (db) => {
          const subject = r.subject
          const owner = await db.findOne(Owner, {
            where: { subject },
            lock: {
              mode:
                r.method === 'list' ? 'pessimistic_read' : 'pessimistic_write',
            },
          })
          if (
            r.appId !== 'todo' ||
            !owner?.active ||
            owner.generation !== r.generation ||
            owner.releaseId !== r.releaseId
          ) {
            throw TodoError.TODO_INSTALLATION()
          }
          const args = r.arguments as Record<string, unknown>
          if (r.method === 'list') {
            if (args.version !== undefined && args.version !== owner.version) {
              throw TodoError.TODO_CONFLICT()
            }
            const cursor = typeof args.cursor === 'string' ? args.cursor : ''
            if (!cursor && args.knownVersion === owner.version) {
              return {
                unchanged: true,
                version: owner.version,
                rows: [],
                next: null,
              }
            }
            const batch = await db.find(Entry, {
              where: { subject, id: MoreThan(cursor) },
              order: { id: 'ASC' },
              take: 51,
            })
            const rows = []
            const encoder = new TextEncoder()
            let bytes = 0
            for (const { id, item, revision, created } of batch.slice(0, 50)) {
              const record = {
                item,
                revision,
                created,
                ...(id.includes('~') ? { until: id.slice(-10) } : {}),
              }
              bytes += encoder.encode(JSON.stringify(record)).byteLength
              if (rows.length && bytes > 500000) {
                break
              }
              rows.push(record)
            }
            return {
              rows,
              next:
                batch.length > rows.length ? batch[rows.length - 1]!.id : null,
              version: owner.version,
            }
          }
          if (r.method !== 'save') {
            throw TodoError.TODO_INVALID()
          }
          const item = validate(args.item)
          const key = fingerprint(['save', r.invocationId])
          const hash = fingerprint(args)
          const prior = await db.findOneBy(Receipt, { subject, key })
          if (prior) {
            if (prior.hash !== hash) {
              throw TodoError.TODO_CONFLICT()
            }
            return prior.response
          }
          const old = await db.findOneBy(Entry, { subject, id: item.id })
          if (
            (old?.revision ?? 0) !== args.revision ||
            (old && old.item.kind !== item.kind)
          ) {
            throw TodoError.TODO_CONFLICT()
          }
          if (item.kind === 'period') {
            const parent = await db.findOneBy(Entry, {
              subject,
              id: item.series,
            })
            if (
              parent?.item.kind !== 'list' ||
              (!old && args.seriesRevision !== parent.revision)
            ) {
              throw TodoError.TODO_CONFLICT()
            }
            if (!old) {
              const archived = await db
                .getRepository(Entry)
                .createQueryBuilder('e')
                .where(
                  'e.subject = :subject AND e.id >= :start AND e.id <= :end',
                  {
                    subject,
                    start: item.series + '~' + item.scheduled,
                    end: item.series + '~9999-12-31',
                  },
                )
                .orderBy('e.id', 'ASC')
                .getOne()
              if (!occurs(archived?.item ?? parent.item, item.scheduled)) {
                throw TodoError.TODO_INVALID('该日期没有安排')
              }
            }
          }
          const revision = (old?.revision ?? 0) + 1
          const created = old?.created ?? new Date().toISOString()
          if (old && item.kind === 'list') {
            const day = localDay(new Date(), old.item.rule!.zone)
            const until =
              old.item.paused !== item.paused ? shift(day, -1) : day
            const snapshotId = item.id + '~' + until
            await db
              .createQueryBuilder()
              .insert()
              .into(Entry)
              .values({
                subject,
                id: snapshotId,
                item: old.item,
                revision: old.revision,
                created: old.created,
              })
              .orIgnore()
              .execute()
          }
          await db.save(Entry, {
            subject,
            id: item.id,
            revision,
            created,
            item,
          })
          await db.increment(Owner, { subject }, 'version', 1)
          const response = { revision, created }
          await db.insert(Receipt, { subject, key, hash, response })
          return response
        }),
    }
  }
}
