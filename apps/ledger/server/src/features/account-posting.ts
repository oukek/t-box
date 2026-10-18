import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { invalid } from '@t-box/server-foundation/errors'
import { money } from '../finance/money.js'
import {
  LedgerAccountEntity,
  LedgerAccountEntryEntity,
} from '../persistence/accounts-entities.js'
/** Same book lock and transaction as the originating financial event. */
export async function postAccount(
  db: EntityManager,
  book: string,
  account: string | null | undefined,
  subject: string,
  date: string,
  value: bigint,
  note: string,
  actor: string | null,
) {
  if (!account || value === 0n) {
    return
  }
  const row = await db.getRepository(LedgerAccountEntity).findOne({
    select: { id: true, archived: true },
    where: { ledger_id: book, id: account },
  })
  if (!row) {
    invalid('accountId', '资金账户不存在或不属于此账本')
  }
  // Reversals can post to archived accounts; callers validate active accounts for new operations.
  await db.getRepository(LedgerAccountEntryEntity).insert({
    id: randomUUID(),
    ledger_id: book,
    account_id: account,
    subject_id: subject,
    entry_date: date,
    amount: money(value),
    note,
    created_by: actor,
  })
}
export async function activeAccount(
  db: EntityManager,
  book: string,
  id: string | null | undefined,
) {
  if (!id) {
    return
  }
  const row = await db.getRepository(LedgerAccountEntity).findOne({
    select: { id: true },
    where: { ledger_id: book, id, archived: false },
  })
  if (!row) {
    invalid('accountId', '请选择此账本可用的资金账户')
  }
}
