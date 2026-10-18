import type { LedgerDebtAdjustment } from '@t-box/ledger-contracts'
import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerContact {
  id: string
  ledger_id: string
  name: string
  note: string
  archived: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerContactEntity = new EntitySchema<StoredLedgerContact>({
  name: 'LedgerContact',
  tableName: 'ledger_contacts',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    name: { type: 'varchar', length: 80 },
    note: { type: 'varchar', length: 200 },
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
  indices: [
    { name: 'idx_book', columns: ['ledger_id'] },
    { name: 'uq_contact_name', columns: ['ledger_id', 'name'], unique: true },
  ],
})

export interface StoredLedgerDebtAdjustment {
  id: string
  ledger_id: string
  debt_id: string
  kind: LedgerDebtAdjustment['kind']
  amount: string
  adjustment_date: string
  note: string
  reversed: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerDebtAdjustmentEntity =
  new EntitySchema<StoredLedgerDebtAdjustment>({
    name: 'LedgerDebtAdjustment',
    tableName: 'ledger_debt_adjustments',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      debt_id: { type: 'char', name: 'debt_id', length: 36 },
      kind: { type: 'varchar', length: 12 },
      amount: { type: 'decimal', precision: 11, scale: 2 },
      adjustment_date: { type: 'date', name: 'adjustment_date' },
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

export interface StoredLedgerImportDraft {
  id: string
  ledger_id: string
  user_id: string
  rows_json: JsonDocument
  status: string
  result_json: JsonDocument
  expires_at: string
  created_by: string | null
  created_at: string
}

export const LedgerImportDraftEntity =
  new EntitySchema<StoredLedgerImportDraft>({
    name: 'LedgerImportDraft',
    tableName: 'ledger_import_drafts',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      user_id: { type: 'char', name: 'user_id', length: 36 },
      rows_json: { type: 'json', name: 'rows_json' },
      status: { type: 'varchar', length: 12 },
      result_json: { type: 'json', name: 'result_json', nullable: true },
      expires_at: {
        type: 'datetime',
        name: 'expires_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
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

export interface StoredLedgerTemplate {
  id: string
  ledger_id: string
  name: string
  bill_json: JsonDocument
  created_by: string | null
  created_at: string
}

export const LedgerTemplateEntity = new EntitySchema<StoredLedgerTemplate>({
  name: 'LedgerTemplate',
  tableName: 'ledger_templates',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    name: { type: 'varchar', length: 60 },
    bill_json: { type: 'json', name: 'bill_json' },
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
