import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerAccountEntry {
  id: string
  ledger_id: string
  account_id: string
  subject_id: string
  entry_date: string
  amount: string
  note: string
  created_by: string | null
  created_at: string
}

export const LedgerAccountEntryEntity =
  new EntitySchema<StoredLedgerAccountEntry>({
    name: 'LedgerAccountEntry',
    tableName: 'ledger_account_entries',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      account_id: { type: 'char', name: 'account_id', length: 36 },
      subject_id: { type: 'char', name: 'subject_id', length: 36 },
      entry_date: { type: 'date', name: 'entry_date' },
      amount: { type: 'decimal', precision: 20, scale: 2 },
      note: { type: 'varchar', length: 200 },
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
      {
        name: 'idx_account_date',
        columns: ['ledger_id', 'account_id', 'entry_date'],
      },
      { name: 'idx_book', columns: ['ledger_id'] },
    ],
  })

export interface StoredLedgerAccount {
  id: string
  ledger_id: string
  name: string
  kind: string
  archived: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerAccountEntity = new EntitySchema<StoredLedgerAccount>({
  name: 'LedgerAccount',
  tableName: 'ledger_accounts',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    name: { type: 'varchar', length: 60 },
    kind: { type: 'varchar', length: 12 },
    archived: { type: 'tinyint' },
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

export interface StoredLedgerTransfer {
  id: string
  ledger_id: string
  from_account_id: string
  to_account_id: string
  amount: string
  transfer_date: string
  note: string
  reversed: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerTransferEntity = new EntitySchema<StoredLedgerTransfer>({
  name: 'LedgerTransfer',
  tableName: 'ledger_transfers',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    from_account_id: { type: 'char', name: 'from_account_id', length: 36 },
    to_account_id: { type: 'char', name: 'to_account_id', length: 36 },
    amount: { type: 'decimal', precision: 11, scale: 2 },
    transfer_date: { type: 'date', name: 'transfer_date' },
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
  indices: [{ name: 'idx_book', columns: ['ledger_id'] }],
})
