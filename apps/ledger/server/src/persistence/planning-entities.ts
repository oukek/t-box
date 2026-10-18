import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredLedgerBudget {
  id: string
  ledger_id: string
  budget_month: string
  category_id: string
  amount: string
  created_by: string | null
  created_at: string
}

export const LedgerBudgetEntity = new EntitySchema<StoredLedgerBudget>({
  name: 'LedgerBudget',
  tableName: 'ledger_budgets',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    budget_month: { type: 'char', name: 'budget_month', length: 7 },
    category_id: { type: 'varchar', name: 'category_id', length: 36 },
    amount: { type: 'decimal', precision: 11, scale: 2 },
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
      name: 'uq_budget',
      columns: ['ledger_id', 'budget_month', 'category_id'],
      unique: true,
    },
  ],
})

export interface StoredLedgerNotice {
  id: string
  ledger_id: string
  user_id: string
  dedupe_key: string
  title: string
  body: string
  is_read: number | boolean
  created_by: string | null
  created_at: string
}

export const LedgerNoticeEntity = new EntitySchema<StoredLedgerNotice>({
  name: 'LedgerNotice',
  tableName: 'ledger_notices',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    dedupe_key: { type: 'varchar', name: 'dedupe_key', length: 128 },
    title: { type: 'varchar', length: 100 },
    body: { type: 'varchar', length: 400 },
    is_read: { type: 'tinyint', name: 'is_read' },
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
      name: 'uq_notice',
      columns: ['ledger_id', 'user_id', 'dedupe_key'],
      unique: true,
    },
  ],
})

export interface StoredLedgerRuleRun {
  id: string
  ledger_id: string
  rule_id: string
  occurrence_date: string
  bill_id: string | null
  created_by: string | null
  created_at: string
}

export const LedgerRuleRunEntity = new EntitySchema<StoredLedgerRuleRun>({
  name: 'LedgerRuleRun',
  tableName: 'ledger_rule_runs',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    rule_id: { type: 'char', name: 'rule_id', length: 36 },
    occurrence_date: { type: 'date', name: 'occurrence_date' },
    bill_id: { type: 'char', name: 'bill_id', length: 36, nullable: true },
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
      name: 'uq_rule_occurrence',
      columns: ['rule_id', 'occurrence_date'],
      unique: true,
    },
  ],
})

export interface StoredLedgerRule {
  id: string
  ledger_id: string
  name: string
  bill_json: JsonDocument
  frequency: string
  interval_count: number
  start_date: string
  next_date: string
  end_date: string | null
  mode: string
  grant_version: number
  enabled: number | boolean
  last_error: string | null
  created_by: string | null
  created_at: string
}

export const LedgerRuleEntity = new EntitySchema<StoredLedgerRule>({
  name: 'LedgerRule',
  tableName: 'ledger_rules',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    ledger_id: { type: 'char', name: 'ledger_id', length: 36 },
    name: { type: 'varchar', length: 60 },
    bill_json: { type: 'json', name: 'bill_json' },
    frequency: { type: 'varchar', length: 8 },
    interval_count: { type: 'int', name: 'interval_count' },
    start_date: { type: 'date', name: 'start_date' },
    next_date: { type: 'date', name: 'next_date' },
    end_date: { type: 'date', name: 'end_date', nullable: true },
    mode: { type: 'varchar', length: 10 },
    grant_version: { type: 'int', name: 'grant_version' },
    enabled: { type: 'tinyint' },
    last_error: {
      type: 'varchar',
      name: 'last_error',
      length: 200,
      nullable: true,
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
    { name: 'idx_rule_due', columns: ['enabled', 'next_date'] },
  ],
})
