import type { ModelCallPurpose, ModelPrices } from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredBillingAudit {
  id: string
  user_id: string
  administrator_id: string
  action: string
  detail: string
  created_at: string
}

export const BillingAuditEntity = new EntitySchema<StoredBillingAudit>({
  name: 'BillingAudit',
  tableName: 'billing_audit',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    administrator_id: { type: 'char', name: 'administrator_id', length: 36 },
    action: { type: 'varchar', length: 40 },
    detail: { type: 'varchar', length: 300 },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [{ name: 'fk_billing_audit_user', columns: ['user_id'] }],
})

export interface StoredBillingEntry {
  id: string
  user_id: string
  kind: 'usage' | 'recharge' | 'grant' | 'refund'
  reference_key: string
  amount_micro: string
  balance_micro: string
  reason: string
  administrator_id: string | null
  created_at: string
}

export const BillingEntryEntity = new EntitySchema<StoredBillingEntry>({
  name: 'BillingEntry',
  tableName: 'billing_entries',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    kind: { type: 'enum', enum: ['usage', 'recharge', 'grant', 'refund'] },
    reference_key: { type: 'varchar', name: 'reference_key', length: 120 },
    amount_micro: { type: 'bigint', name: 'amount_micro' },
    balance_micro: { type: 'bigint', name: 'balance_micro' },
    reason: { type: 'varchar', length: 200 },
    administrator_id: {
      type: 'char',
      name: 'administrator_id',
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
    { name: 'ix_entry_user', columns: ['user_id', 'created_at'] },
    { name: 'ux_entry_reference', columns: ['reference_key'], unique: true },
  ],
})

export interface StoredBillingUsage {
  id: string
  user_id: string
  task_id: string | null
  model_config_id: string
  prices_json: ModelPrices
  kind: 'conversation' | 'image'
  mode: 'charge' | 'record_only'
  status: 'reserved' | 'settled' | 'review' | 'released'
  reserved_micro: string
  fee_micro: string
  charged_micro: string
  input_tokens: string | number | null
  output_tokens: string | number | null
  images: number | null
  response_id: string | null
  created_at: string
  updated_at: string
  message_id: string | null
  agent_id: string | null
  purpose: ModelCallPurpose
  cached_tokens: string | number | null
  reasoning_tokens: string | number | null
  duration_ms: number | null
  cache_write_tokens: string | number | null
  cost_reserved_micro: string
}

export const BillingUsageEntity = new EntitySchema<StoredBillingUsage>({
  name: 'BillingUsage',
  tableName: 'billing_usage',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    task_id: { type: 'char', name: 'task_id', length: 36, nullable: true },
    model_config_id: { type: 'char', name: 'model_config_id', length: 36 },
    prices_json: { type: 'json', name: 'prices_json' },
    kind: { type: 'enum', enum: ['conversation', 'image'] },
    mode: { type: 'enum', enum: ['charge', 'record_only'] },
    status: {
      type: 'enum',
      enum: ['reserved', 'settled', 'review', 'released'],
    },
    reserved_micro: { type: 'bigint', name: 'reserved_micro' },
    fee_micro: { type: 'bigint', name: 'fee_micro' },
    charged_micro: { type: 'bigint', name: 'charged_micro' },
    input_tokens: { type: 'bigint', name: 'input_tokens', nullable: true },
    output_tokens: { type: 'bigint', name: 'output_tokens', nullable: true },
    images: { type: 'int', nullable: true },
    response_id: {
      type: 'varchar',
      name: 'response_id',
      length: 200,
      nullable: true,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    updated_at: {
      type: 'datetime',
      name: 'updated_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    message_id: {
      type: 'char',
      name: 'message_id',
      length: 36,
      nullable: true,
    },
    agent_id: {
      type: 'varchar',
      name: 'agent_id',
      length: 100,
      nullable: true,
    },
    purpose: { type: 'varchar', length: 20 },
    cached_tokens: { type: 'bigint', name: 'cached_tokens', nullable: true },
    reasoning_tokens: {
      type: 'bigint',
      name: 'reasoning_tokens',
      nullable: true,
    },
    duration_ms: { type: 'int', name: 'duration_ms', nullable: true },
    cache_write_tokens: {
      type: 'bigint',
      name: 'cache_write_tokens',
      nullable: true,
    },
    cost_reserved_micro: { type: 'bigint', name: 'cost_reserved_micro' },
  },
  indices: [
    { name: 'ix_usage_status', columns: ['status', 'updated_at'] },
    { name: 'ix_usage_user', columns: ['user_id', 'created_at'] },
    { name: 'usage_daily_cost', columns: ['created_at'] },
    { name: 'usage_task_cost', columns: ['task_id'] },
  ],
})

export interface StoredBillingWallet {
  user_id: string
  balance_micro: string
  reserved_micro: string
  mode: 'charge' | 'record_only'
}

export const BillingWalletEntity = new EntitySchema<StoredBillingWallet>({
  name: 'BillingWallet',
  tableName: 'billing_wallets',
  columns: {
    user_id: { type: 'char', name: 'user_id', length: 36, primary: true },
    balance_micro: { type: 'bigint', name: 'balance_micro' },
    reserved_micro: { type: 'bigint', name: 'reserved_micro' },
    mode: { type: 'enum', enum: ['charge', 'record_only'] },
  },
  indices: [],
})
