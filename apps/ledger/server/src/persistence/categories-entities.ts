import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerCategoryCatalog {
  id: number
  revision: number
}

export const LedgerCategoryCatalogEntity =
  new EntitySchema<StoredLedgerCategoryCatalog>({
    name: 'LedgerCategoryCatalog',
    tableName: 'ledger_category_catalog',
    columns: {
      id: { type: 'tinyint', primary: true },
      revision: { type: 'int' },
    },
    indices: [],
  })

export interface StoredLedgerCategoryIcon {
  id: string
  ledger_id: string
  created_by: string
  content: string | null
  created_at: string
  object_path: string | null
  storage_backend: string | null
}

export const LedgerCategoryIconEntity =
  new EntitySchema<StoredLedgerCategoryIcon>({
    name: 'LedgerCategoryIcon',
    tableName: 'ledger_category_icons',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      created_by: { type: 'char', name: 'created_by', length: 36 },
      content: { type: 'blob', nullable: true },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
      object_path: {
        type: 'varchar',
        name: 'object_path',
        length: 512,
        nullable: true,
      },
      storage_backend: {
        type: 'varchar',
        name: 'storage_backend',
        length: 64,
        nullable: true,
      },
    },
    indices: [{ name: 'idx_category_icon_book', columns: ['ledger_id'] }],
  })

export interface StoredLedgerCategoryPresetAudit {
  id: string
  preset_id: string
  administrator_id: string
  before_json: JsonDocument
  after_json: JsonDocument
  created_at: string
}

export const LedgerCategoryPresetAuditEntity =
  new EntitySchema<StoredLedgerCategoryPresetAudit>({
    name: 'LedgerCategoryPresetAudit',
    tableName: 'ledger_category_preset_audit',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      preset_id: { type: 'char', name: 'preset_id', length: 36 },
      administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
      before_json: { type: 'json', name: 'before_json', nullable: true },
      after_json: { type: 'json', name: 'after_json' },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'idx_preset_audit', columns: ['preset_id', 'created_at'] },
    ],
  })

export interface StoredLedgerCategoryPreset {
  id: string
  type: 'income' | 'expense'
  label: string
  icon: string
  active: number | boolean
  sort_order: number
  revision: number
  updated_at: string
}

export const LedgerCategoryPresetEntity =
  new EntitySchema<StoredLedgerCategoryPreset>({
    name: 'LedgerCategoryPreset',
    tableName: 'ledger_category_presets',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      type: { type: 'enum', enum: ['income', 'expense'] },
      label: { type: 'varchar', length: 40 },
      icon: { type: 'varchar', length: 32 },
      active: { type: 'tinyint' },
      sort_order: { type: 'int', name: 'sort_order' },
      revision: { type: 'int' },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      { name: 'uq_preset_label', columns: ['type', 'label'], unique: true },
    ],
  })

export interface StoredLedgerCategoryRecent {
  id: string
  ledger_id: string
  user_id: string
  category_id: string
  last_used_at: string
  created_by: string | null
  created_at: string
}

export const LedgerCategoryRecentEntity =
  new EntitySchema<StoredLedgerCategoryRecent>({
    name: 'LedgerCategoryRecent',
    tableName: 'ledger_category_recents',
    columns: {
      id: { type: 'char', length: 36, primary: true },
      ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
      user_id: { type: 'char', name: 'user_id', length: 36 },
      category_id: { type: 'varchar', name: 'category_id', length: 36 },
      last_used_at: {
        type: 'datetime',
        name: 'last_used_at',
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
    indices: [
      { name: 'idx_book', columns: ['ledger_id'] },
      {
        name: 'uq_category_recent',
        columns: ['ledger_id', 'user_id', 'category_id'],
        unique: true,
      },
    ],
  })
