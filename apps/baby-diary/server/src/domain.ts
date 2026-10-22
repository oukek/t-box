import type { BabyScope } from '@t-box/baby-diary-contracts'
import type { PrivateMediaPort } from '@t-box/server-foundation/persistence/private-media'
import type { DataSource, EntityManager } from 'typeorm'
import type { BabyAction } from './access.js'
import { randomUUID } from 'node:crypto'
import { BabyErrorCode } from '@t-box/baby-diary-contracts'
import { fingerprint } from '@t-box/server-foundation/persistence/operations'
import { BabyAccess } from './access.js'
import {
  BabyActorEntity,
  BabyAuditEntity,
  BabyOperationEntity,
  BabyProfileEntity,
} from './entities.js'

export class BabyDomain {
  readonly access: BabyAccess
  constructor(
    readonly source: DataSource,
    readonly media: PrivateMediaPort,
    readonly expected?: { generation: number, releaseId: string },
  ) {
    this.access = new BabyAccess(source)
  }

  async mutate<T>(
    subject: string,
    babyId: string | null,
    action: string,
    key: string,
    payload: unknown,
    capability: BabyAction,
    scope: BabyScope | undefined,
    work: (db: EntityManager) => Promise<T>,
    beforeReplay?: (db: EntityManager) => Promise<void>,
  ) {
    if (
      !/^[a-f0-9]{64}$/.test(subject) ||
      typeof key !== 'string' ||
      key.length < 8 ||
      key.length > 200
    ) {
      throw BabyErrorCode.BABY_INVALID_INPUT('操作标识无效')
    }
    const operationKey = fingerprint([action, key])
    const payloadHash = fingerprint(payload)
    return this.source.transaction('READ COMMITTED', async (db) => {
      const actor = await db.getRepository(BabyActorEntity).findOne({
        select: {
          subject: true,
          generation: true,
          releaseId: true,
          active: true,
        },
        where: { subject },
        lock: { mode: 'pessimistic_write' },
      })
      if (
        !this.expected ||
        !actor?.active ||
        actor.generation !== this.expected.generation ||
        actor.releaseId !== this.expected.releaseId
      ) {
        throw BabyErrorCode.BABY_INSTALLATION_CHANGED()
      }
      if (babyId) {
        await this.access.check(
          subject,
          babyId,
          capability,
          scope,
          'members',
          db,
          capability === 'own',
        )
      }
      await beforeReplay?.(db)
      const operations = db.getRepository(BabyOperationEntity)
      const prior = await operations.findOne({
        select: { payloadHash: true, response: true },
        where: { subject, operationKey },
      })
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          throw BabyErrorCode.BABY_CONFLICT('同一操作标识不能用于不同内容')
        }
        if (action === 'baby.create') {
          await this.access.check(
            subject,
            (prior.response as { id: string }).id,
            'read',
            undefined,
            'members',
            db,
          )
        }
        return prior.response as T
      }
      const response = await work(db)
      await operations.save({
        subject,
        operationKey,
        payloadHash,
        response,
        createdAt: new Date(),
      })
      if (babyId && !action.startsWith('baby.')) {
        await db
          .getRepository(BabyProfileEntity)
          .increment({ id: babyId }, 'revision', 1)
      }
      if (babyId) {
        await this.audit(db, subject, babyId, action, '')
      }
      return response
    })
  }

  async audit(
    db: EntityManager,
    actor: string,
    babyId: string,
    action: string,
    targetId: string,
  ) {
    await db.getRepository(BabyAuditEntity).insert({
      id: randomUUID(),
      babyId,
      actor,
      action,
      targetId,
      createdAt: new Date(),
    })
  }

  revision(current: number, expected: unknown) {
    if (current !== expected) {
      throw BabyErrorCode.BABY_CONFLICT()
    }
  }
}
