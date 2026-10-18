import type { LedgerReimbursementSummary } from '@t-box/ledger-contracts'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerRefund {
  id: string
  ledger_id: string
  bill_id: string
  amount: string
  refund_date: string
  note: string
  account_id: string | null
  reversed: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerRefundEntity = new EntitySchema<StoredLedgerRefund>({
  name: 'LedgerRefund',
  tableName: 'ledger_refunds',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    bill_id: { type: 'char', name: 'bill_id', length: 36 },
    amount: { type: 'decimal', precision: 11, scale: 2 },
    refund_date: { type: 'date', name: 'refund_date' },
    note: { type: 'varchar', length: 200 },
    account_id: {
      type: 'char',
      name: 'account_id',
      length: 36,
      nullable: true,
    },
    reversed: { type: 'tinyint' },
    created_by: {
      type: 'char',
      name: 'created_by',
      length: 36,
      nullable: true,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [
    { name: 'idx_book', columns: ['ledger_id'] },
    { name: 'idx_refund_bill', columns: ['ledger_id', 'bill_id'] },
    {
      name: 'idx_refund_period',
      columns: ['ledger_id', 'reversed', 'refund_date'],
    },
  ],
})

export interface StoredLedgerReimbursementReceipt {
  id: string
  ledger_id: string
  reimbursement_id: string
  amount: string
  receipt_date: string
  account_id: string | null
  note: string
  reversed: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerReimbursementReceiptEntity =
  new EntitySchema<StoredLedgerReimbursementReceipt>({
    name: 'LedgerReimbursementReceipt',
    tableName: 'ledger_reimbursement_receipts',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      reimbursement_id: { type: 'char', name: 'reimbursement_id', length: 36 },
      amount: { type: 'decimal', precision: 11, scale: 2 },
      receipt_date: { type: 'date', name: 'receipt_date' },
      account_id: {
        type: 'char',
        name: 'account_id',
        length: 36,
        nullable: true,
      },
      note: { type: 'varchar', length: 200 },
      reversed: { type: 'tinyint' },
      created_by: {
        type: 'char',
        name: 'created_by',
        length: 36,
        nullable: true,
      },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'idx_book', columns: ['ledger_id'] },
      {
        name: 'idx_receipt_period',
        columns: ['ledger_id', 'reversed', 'receipt_date'],
      },
    ],
  })

export interface StoredLedgerReimbursement {
  id: string
  ledger_id: string
  bill_id: string
  counterparty: string
  amount: string
  received: string
  status: LedgerReimbursementSummary['status']
  created_by: string | null
  created_at: string
}

export const LedgerReimbursementEntity =
  new EntitySchema<StoredLedgerReimbursement>({
    name: 'LedgerReimbursement',
    tableName: 'ledger_reimbursements',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      bill_id: { type: 'char', name: 'bill_id', length: 36 },
      counterparty: { type: 'varchar', length: 80 },
      amount: { type: 'decimal', precision: 11, scale: 2 },
      received: { type: 'decimal', precision: 11, scale: 2 },
      status: { type: 'varchar', length: 12 },
      created_by: {
        type: 'char',
        name: 'created_by',
        length: 36,
        nullable: true,
      },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [{ name: 'idx_book', columns: ['ledger_id'] }],
  })
