import type {
  ModelCallPurpose,
  ModelPrices,
  QuotaTariff,
  QuotaUsageBudget,
} from '@t-box/shared'
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

export interface StoredBillingUsage {
  id: string
  user_id: string
  task_id: string | null
  model_config_id: string
  prices_json: ModelPrices
  kind: 'conversation' | 'image'
  mode: 'charge' | 'record_only'
  status: 'reserved' | 'settled' | 'review' | 'released' | 'reversed'
  fee_micro: string
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
  quota_reserved: string
  quota_budget: string
  quota_due: string
  quota_charged: string
  upstream_original_micro: string
  tariff_json: QuotaTariff
  budget_json: QuotaUsageBudget
  platform_free: boolean
  logical_id: string
  retry_index: number
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
      enum: ['reserved', 'settled', 'review', 'released', 'reversed'],
    },
    fee_micro: { type: 'bigint', name: 'fee_micro' },
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
    quota_reserved: { type: 'bigint', default: '0' },
    quota_budget: { type: 'bigint', default: '0' },
    quota_due: { type: 'bigint', default: '0' },
    quota_charged: { type: 'bigint', default: '0' },
    upstream_original_micro: { type: 'bigint', default: '0' },
    tariff_json: { type: 'json' },
    budget_json: { type: 'json' },
    platform_free: { type: Boolean, default: false },
    logical_id: { type: 'char', length: 36 },
    retry_index: { type: 'int', default: 0 },
  },
  indices: [
    { name: 'ix_usage_status', columns: ['status', 'updated_at'] },
    { name: 'ix_usage_user', columns: ['user_id', 'created_at'] },
    { name: 'usage_daily_cost', columns: ['created_at'] },
    { name: 'usage_task_cost', columns: ['task_id'] },
  ],
})
