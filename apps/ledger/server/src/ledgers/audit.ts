import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { jsonDocument } from '@t-box/server-foundation/persistence/columns'
import { LedgerAuditEntity } from '../domain-entities.js'

export async function audit(
  db: EntityManager,
  ledgerId: string,
  userId: string | null,
  action: string,
  subjectId: string | null,
  details: unknown = {},
) {
  await db.getRepository(LedgerAuditEntity).insert({
    id: randomUUID(),
    ledgerId,
    userId,
    action,
    subjectId,
    details: jsonDocument(details),
  })
}
