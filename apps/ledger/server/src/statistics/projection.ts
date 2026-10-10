import type { LedgerCashEntry } from '@t-box/ledger-contracts'
import type { EntityManager } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { money } from '../finance/money.js'

export interface FinancialDelta {
  subjectId: string
  kind: LedgerCashEntry['kind']
  date: string
  note: string
  createdBy: string | null
  income?: bigint
  expense?: bigint
  cashIn?: bigint
  cashOut?: bigint
  receivable?: bigint
  payable?: bigint
  count?: number
  categoryId?: string
  billType?: 'income' | 'expense'
}
/** Called inside the same transaction as its originating write, under the book lock. */
export async function project(
  db: EntityManager,
  ledgerId: string,
  delta: FinancialDelta,
) {
  const values = [
    delta.income ?? 0n,
    delta.expense ?? 0n,
    delta.cashIn ?? 0n,
    delta.cashOut ?? 0n,
    delta.receivable ?? 0n,
    delta.payable ?? 0n,
  ].map(money)
  await db.query(
    `INSERT INTO ledger_events(id,ledger_id,subject_id,kind,event_date,income,expense,cash_in,cash_out,receivable_delta,payable_delta,record_count,category_id,bill_type,note,created_by)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      randomUUID(),
      ledgerId,
      delta.subjectId,
      delta.kind,
      delta.date,
      ...values,
      delta.count ?? 0,
      delta.categoryId ?? null,
      delta.billType ?? null,
      delta.note,
      delta.createdBy,
    ],
  )
  await db.query(
    `INSERT INTO ledger_daily_stats(ledger_id,stat_date,income,expense,cash_in,cash_out,receivable_delta,payable_delta,record_count)
    VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
    income=income+VALUES(income),expense=expense+VALUES(expense),cash_in=cash_in+VALUES(cash_in),cash_out=cash_out+VALUES(cash_out),
    receivable_delta=receivable_delta+VALUES(receivable_delta),payable_delta=payable_delta+VALUES(payable_delta),record_count=record_count+VALUES(record_count)`,
    [ledgerId, delta.date, ...values, delta.count ?? 0],
  )
  if (delta.categoryId && delta.billType) {
    await db.query(
      `INSERT INTO ledger_daily_categories(ledger_id,stat_date,category_id,type,amount,record_count) VALUES(?,?,?,?,?,?)
      ON DUPLICATE KEY UPDATE amount=amount+VALUES(amount),record_count=record_count+VALUES(record_count)`,
      [
        ledgerId,
        delta.date,
        delta.categoryId,
        delta.billType,
        money((delta.income ?? 0n) + (delta.expense ?? 0n)),
        delta.count ?? 0,
      ],
    )
  }
}
export async function rebuild(db: EntityManager, ledgerId: string) {
  await db.query('DELETE FROM ledger_daily_stats WHERE ledger_id=?', [
    ledgerId,
  ])
  await db.query('DELETE FROM ledger_daily_categories WHERE ledger_id=?', [
    ledgerId,
  ])
  await db.query(
    `INSERT INTO ledger_daily_stats SELECT ledger_id,event_date,SUM(income),SUM(expense),SUM(cash_in),SUM(cash_out),SUM(receivable_delta),SUM(payable_delta),SUM(record_count)
    FROM ledger_events WHERE ledger_id=? GROUP BY ledger_id,event_date`,
    [ledgerId],
  )
  await db.query(
    `INSERT INTO ledger_daily_categories SELECT ledger_id,event_date,category_id,bill_type,SUM(income+expense),SUM(record_count)
    FROM ledger_events WHERE ledger_id=? AND category_id IS NOT NULL GROUP BY ledger_id,event_date,category_id,bill_type`,
    [ledgerId],
  )
}
