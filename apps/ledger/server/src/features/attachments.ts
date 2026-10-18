import type { LedgerRecordKind } from '@t-box/ledger-contracts'
import type { EntityManager } from 'typeorm'
import type { Principal } from '../ledgers/types.js'
import { randomUUID } from 'node:crypto'
import {
  LEDGER_ATTACHMENT_LIMIT,
  LEDGER_ATTACHMENT_MAX_BYTES,
  ledgerRecordKinds,
} from '@t-box/ledger-contracts'
import { invalid } from '@t-box/server-foundation/errors'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { In, IsNull } from 'typeorm'
import { ErrorCode } from '../error-codes.js'
import { LedgerAttachmentEntity } from '../persistence/attachments-entities.js'
import { parseId } from '../validation.js'
import { attachmentIds } from './attachment-input.js'
import { FeatureService } from './base.js'

export { attachmentIds } from './attachment-input.js'

const tables: Record<LedgerRecordKind, string> = {
  'bill': 'bills',
  'debt': 'debt_positions',
  'settlement': 'debt_settlements',
  'refund': 'ledger_refunds',
  'transfer': 'ledger_transfers',
  'reimbursement': 'ledger_reimbursements',
  'reimbursement-receipt': 'ledger_reimbursement_receipts',
  'debt-adjustment': 'ledger_debt_adjustments',
  'account-entry': 'ledger_account_entries',
}
export function recordKind(value: unknown): LedgerRecordKind {
  if (!ledgerRecordKinds.includes(value as LedgerRecordKind)) {
    invalid('kind', '记录类型无效')
  }
  return value as LedgerRecordKind
}
export async function attachmentSubject(
  db: EntityManager,
  book: string,
  kind: LedgerRecordKind,
  id: string,
) {
  const [row] = await db
    .createQueryBuilder()
    .select('created_by')
    .from(`${tables[kind]}`, `${tables[kind]}`)
    .where(
      `ledger_id=:p0 AND id=:p1${kind === 'bill' ? ' AND deleted_at IS NULL' : ''}`,
    )
    .setParameters({ p0: book, p1: id })
    .getRawMany()
  if (!row) {
    throw ErrorCode.RECORD_NOT_FOUND()
  }
  return row
}
/** Runs inside the record's transaction; never creates resources or opens a second transaction. */
export async function bindAttachments(
  db: EntityManager,
  actor: Principal,
  book: string,
  kind: LedgerRecordKind,
  id: string,
  value: unknown,
) {
  const ids = attachmentIds(value)
  if (!ids?.length) {
    return
  }
  await attachmentSubject(db, book, kind, id)
  const attachments = db.getRepository(LedgerAttachmentEntity)
  const target = { ledger_id: book, subject_kind: kind, subject_id: id }
  const count = await attachments.countBy(target)
  const already = await attachments.countBy({ ...target, resource_id: In(ids) })
  if (count + ids.length - already > LEDGER_ATTACHMENT_LIMIT) {
    invalid('attachments', '每笔最多 20 个附件')
  }
  for (const resource of ids) {
    const r = await db.getRepository(ResourceEntity).findOne({
      select: { id: true, size: true },
      where: { id: resource, user_id: actor.user.id, deleted_at: IsNull() },
      lock: { mode: 'pessimistic_read' },
    })
    if (!r) {
      throw ErrorCode.RESOURCE_NOT_FOUND('附件不存在或不属于当前用户')
    }
    if (Number(r.size) > LEDGER_ATTACHMENT_MAX_BYTES) {
      invalid('attachments', '每个附件最大 10 MB')
    }
    await db
      .createQueryBuilder()
      .insert()
      .into('ledger_attachments')
      .values({
        id: () => ':p0',
        ledger_id: () => ':p1',
        subject_kind: () => ':p2',
        subject_id: () => ':p3',
        resource_id: () => ':p4',
        created_by: () => ':p5',
      })
      .updateEntity(false)
      .setParameters({
        p0: randomUUID(),
        p1: book,
        p2: kind,
        p3: id,
        p4: resource,
        p5: actor.user.id,
      })
      .orUpdate(['resource_id'])
      .execute()
  }
}

export class AttachmentService extends FeatureService {
  async list(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
  ) {
    await this.read(actor, book)
    await attachmentSubject(this.db, book, kind, id)
    return this.db
      .createQueryBuilder()
      .select(
        'a.id,a.resource_id AS resourceId,r.name,r.mime_type AS mimeType,r.size',
      )
      .from('ledger_attachments', 'a')
      .innerJoin(
        'resources',
        'r',
        'r.id=a.resource_id AND r.deleted_at IS NULL',
      )
      .where('a.ledger_id=:p0 AND a.subject_kind=:p1 AND a.subject_id=:p2')
      .orderBy('a.created_at', 'ASC')
      .addOrderBy('a.id', 'ASC')
      .setParameters({ p0: book, p1: kind, p2: id })
      .getRawMany()
  }

  async add(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
    key: string | undefined,
    resourceIds: string[],
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'attachment.added',
      { kind, subjectId: id, resourceIds },
      async (db, access) => {
        const row = await attachmentSubject(db, book, kind, id)
        this.access.assertAuthor(access.role, row.created_by, actor.user.id)
        await bindAttachments(db, actor, book, kind, id, resourceIds)
        return this.list(actor, book, kind, id)
      },
    )
  }

  async remove(
    actor: Principal,
    book: string,
    kind: LedgerRecordKind,
    id: string,
    attachment: string,
    key: string | undefined,
  ) {
    return this.finance.operations.run(
      actor,
      book,
      key,
      'attachment.removed',
      { kind, subjectId: id, attachment },
      async (db, access) => {
        const record = await attachmentSubject(db, book, kind, id)
        this.access.assertAuthor(access.role, record.created_by, actor.user.id)
        await db.getRepository(LedgerAttachmentEntity).delete({
          ledger_id: book,
          subject_kind: kind,
          subject_id: id,
          id: attachment,
        })
        return { id: attachment }
      },
    )
  }
}

const creationKinds: Record<string, LedgerRecordKind> = {
  'bill.created': 'bill',
  'bill.updated': 'bill',
  'debt.created': 'debt',
  'settlement.created': 'settlement',
  'refund.created': 'refund',
  'transfer.created': 'transfer',
  'reimbursement.requested': 'reimbursement',
  'reimbursement.received': 'reimbursement-receipt',
  'debt.adjusted': 'debt-adjustment',
}
export async function bindOperationAttachments(
  db: EntityManager,
  actor: Principal,
  book: string,
  action: string,
  payload: unknown,
  result: unknown,
) {
  const value = payload as {
    attachmentResourceIds?: unknown
    kind?: string
  } | null
  if (value?.attachmentResourceIds === undefined) {
    return
  }
  const kind =
    action === 'debt.adjusted' && value.kind === 'extension'
      ? 'debt'
      : creationKinds[action]
  if (!kind) {
    invalid('attachmentResourceIds', '此操作不支持记录附件')
  }
  await bindAttachments(
    db,
    actor,
    book,
    kind,
    parseId((result as { id?: unknown })?.id),
    value.attachmentResourceIds,
  )
}
