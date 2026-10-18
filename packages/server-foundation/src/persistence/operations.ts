import type { DataSource, EntityManager } from 'typeorm'
import { createHash } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'
import { ApplicationOperationEntity } from './entities.js'
import { AppUserEntity } from './identity-entities.js'

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableJson((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
export const fingerprint = (value: unknown) =>
  createHash('sha256').update(stableJson(value)).digest('hex')
export async function mutateApplication<T>(
  source: DataSource,
  userId: string,
  appId: string,
  action: string,
  key: unknown,
  payload: unknown,
  run: (db: EntityManager) => Promise<T>,
): Promise<T> {
  if (typeof key !== 'string' || key.length < 8 || key.length > 200) {
    throw ErrorCode.IDEMPOTENCY_REQUIRED('请提供 8 至 200 字符的操作标识')
  }
  const operationKey = fingerprint([action, key])
  const payloadHash = fingerprint(payload)
  return source.transaction(async (db) => {
    const users = await db
      .getRepository(AppUserEntity)
      .find({
        select: { id: true },
        where: { id: userId, enabled: true },
        lock: { mode: 'pessimistic_write' },
      })
      .then((rows) => rows.map((row) => ({ id: row.id })))
    if (!users.length) {
      throw ErrorCode.UNAUTHORIZED()
    }
    const repo = db.getRepository(ApplicationOperationEntity)
    const old = await repo.findOneBy({ userId, appId, operationKey })
    if (old) {
      if (old.payloadHash !== payloadHash) {
        throw ErrorCode.IDEMPOTENCY_CONFLICT('同一操作标识不能用于不同内容')
      }
      return old.response as T
    }
    const response = await run(db)
    await repo.save({
      userId,
      appId,
      operationKey,
      payloadHash,
      response,
      createdAt: new Date(),
    })
    return response
  })
}
