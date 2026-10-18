import type { EntityManager } from 'typeorm'
import type { LedgerAccess } from '../ledgers/access.js'
import type { Access, Principal } from '../ledgers/types.js'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { digest } from '@t-box/server-foundation/crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { jsonDocument } from '@t-box/server-foundation/persistence/columns'
import { LedgerEntity, LedgerOperationEntity } from '../domain-entities.js'
import { ErrorCode } from '../error-codes.js'
import { bindOperationAttachments } from '../features/attachments.js'
import { audit } from '../ledgers/audit.js'
/** One committed result per actor + book + request key, surviving reconnection/restarts. */
export class FinancialOperations {
  private readonly context = new AsyncLocalStorage<{
    db: EntityManager
    access: Access
    ledgerId: string
    sessionHash: string
  }>()

  constructor(readonly access: LedgerAccess) {}
  get manager() {
    return this.context.getStore()?.db ?? this.access.source.manager
  }

  validateKey(key: string | undefined): asserts key is string {
    if (!key || !/^[\w:.\-]{1,128}$/.test(key)) {
      invalid('Idempotency-Key', '请提供有效的操作标识')
    }
  }

  async run<T>(
    principal: Principal,
    ledgerId: string,
    key: string | undefined,
    action: string,
    payload: unknown,
    work: (db: EntityManager, access: Access) => Promise<T>,
  ): Promise<T> {
    this.validateKey(key)
    const hash = digest(JSON.stringify({ action, payload }))
    const execute = async (db: EntityManager, access: Access) => {
      const previous = await db
        .getRepository(LedgerOperationEntity)
        .findOne({
          select: { payloadHash: true, result: true },
          where: {
            ledgerId,
            userId: principal.user.id,
            requestKey: key,
          },
        })
        .then((row) =>
          row
            ? {
                payload_hash: row.payloadHash,
                result_json: row.result,
              }
            : null,
        )
      if (previous) {
        if (previous.payload_hash !== hash) {
          throw ErrorCode.REQUEST_CONFLICT()
        }
        return typeof previous.result_json === 'string'
          ? JSON.parse(previous.result_json)
          : previous.result_json
      }
      const result = await this.context.run(
        { db, access, ledgerId, sessionHash: principal.sessionHash },
        () => work(db, access),
      )
      await bindOperationAttachments(
        db,
        principal,
        ledgerId,
        action,
        payload,
        result,
      )
      await db.getRepository(LedgerOperationEntity).insert({
        id: randomUUID(),
        ledgerId,
        userId: principal.user.id,
        requestKey: key,
        payloadHash: hash,
        action,
        result: jsonDocument(result),
      })
      await db
        .getRepository(LedgerEntity)
        .update({ id: ledgerId }, { revision: () => 'revision+1' })
      await audit(
        db,
        ledgerId,
        principal.user.id,
        action,
        action.startsWith('attachment.')
          ? ((payload as { subjectId?: string, bill?: string } | null)
              ?.subjectId ??
              (payload as { bill?: string } | null)?.bill ??
              null)
          : ((result as { id?: string } | null)?.id ?? null),
        payload,
      )
      return result
    }
    const current = this.context.getStore()
    if (current) {
      if (
        current.ledgerId !== ledgerId ||
        current.sessionHash !== principal.sessionHash
      ) {
        throw ErrorCode.BATCH_SCOPE()
      }
      return execute(current.db, current.access)
    }
    return this.access.transaction(principal, ledgerId, 'write', execute)
  }
}
