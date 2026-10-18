import type { ModelCallStatus } from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredAiCostGuard {
  id: number
}

export const AiCostGuardEntity = new EntitySchema<StoredAiCostGuard>({
  name: 'AiCostGuard',
  tableName: 'ai_cost_guard',
  columns: {
    id: { type: 'int', primary: true },
  },
  indices: [],
})

export interface StoredAiModelCall {
  id: string
  logical_id: string
  retry_index: number
  task_id: string | null
  message_id: string | null
  user_id: string
  provider_id: string
  provider_name: string
  model_id: string
  model_name: string
  remote_model: string
  invocation_mode: string
  purpose: string
  method: string
  status: ModelCallStatus
  input_json: string
  output_json: string | null
  user_error: string | null
  diagnostics_json: string | null
  provider_request_id: string | null
  response_id: string | null
  input_tokens: string | number | null
  output_tokens: string | number | null
  cached_tokens: string | number | null
  reasoning_tokens: string | number | null
  images: number | null
  duration_ms: number | null
  queue_ms: number | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  lease_until: string
}

export const AiModelCallEntity = new EntitySchema<StoredAiModelCall>({
  name: 'AiModelCall',
  tableName: 'ai_model_calls',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    logical_id: { type: 'char', name: 'logical_id', length: 36 },
    retry_index: { type: 'int', name: 'retry_index', unsigned: true },
    task_id: { type: 'char', name: 'task_id', length: 36, nullable: true },
    message_id: {
      type: 'char',
      name: 'message_id',
      length: 36,
      nullable: true,
    },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    provider_id: { type: 'char', name: 'provider_id', length: 36 },
    provider_name: { type: 'varchar', name: 'provider_name', length: 80 },
    model_id: { type: 'char', name: 'model_id', length: 36 },
    model_name: { type: 'varchar', name: 'model_name', length: 80 },
    remote_model: { type: 'varchar', name: 'remote_model', length: 200 },
    invocation_mode: { type: 'varchar', name: 'invocation_mode', length: 32 },
    purpose: { type: 'varchar', length: 32 },
    method: { type: 'varchar', length: 32 },
    status: { type: 'varchar', length: 24 },
    input_json: { type: 'mediumtext', name: 'input_json' },
    output_json: { type: 'mediumtext', name: 'output_json', nullable: true },
    user_error: {
      type: 'varchar',
      name: 'user_error',
      length: 500,
      nullable: true,
    },
    diagnostics_json: {
      type: 'text',
      name: 'diagnostics_json',
      nullable: true,
    },
    provider_request_id: {
      type: 'varchar',
      name: 'provider_request_id',
      length: 256,
      nullable: true,
    },
    response_id: {
      type: 'varchar',
      name: 'response_id',
      length: 256,
      nullable: true,
    },
    input_tokens: {
      type: 'bigint',
      name: 'input_tokens',
      nullable: true,
      unsigned: true,
    },
    output_tokens: {
      type: 'bigint',
      name: 'output_tokens',
      nullable: true,
      unsigned: true,
    },
    cached_tokens: {
      type: 'bigint',
      name: 'cached_tokens',
      nullable: true,
      unsigned: true,
    },
    reasoning_tokens: {
      type: 'bigint',
      name: 'reasoning_tokens',
      nullable: true,
      unsigned: true,
    },
    images: { type: 'int', nullable: true, unsigned: true },
    duration_ms: {
      type: 'int',
      name: 'duration_ms',
      nullable: true,
      unsigned: true,
    },
    queue_ms: { type: 'int', name: 'queue_ms', nullable: true, unsigned: true },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    started_at: {
      type: 'datetime',
      name: 'started_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    finished_at: {
      type: 'datetime',
      name: 'finished_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    lease_until: {
      type: 'datetime',
      name: 'lease_until',
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [
    { name: 'call_model', columns: ['model_id', 'created_at'] },
    { name: 'call_recent', columns: ['created_at', 'id'] },
    { name: 'call_recovery', columns: ['status', 'lease_until'] },
    { name: 'call_task', columns: ['task_id', 'created_at', 'id'] },
    { name: 'call_user', columns: ['user_id', 'created_at'] },
  ],
})

export interface StoredAiModelPool {
  purpose: string
  model_id: string
  position: number
}

export const AiModelPoolEntity = new EntitySchema<StoredAiModelPool>({
  name: 'AiModelPool',
  tableName: 'ai_model_pool',
  columns: {
    purpose: { type: 'varchar', length: 24, primary: true },
    model_id: { type: 'char', name: 'model_id', length: 36, primary: true },
    position: { type: 'int' },
  },
  indices: [{ name: 'pool_position', columns: ['purpose', 'position'] }],
})

export interface StoredAiModelRouteGuard {
  purpose: string
  sequence: string | number
}

export const AiModelRouteGuardEntity =
  new EntitySchema<StoredAiModelRouteGuard>({
    name: 'AiModelRouteGuard',
    tableName: 'ai_model_route_guard',
    columns: {
      purpose: { type: 'varchar', length: 24, primary: true },
      sequence: { type: 'bigint', unsigned: true },
    },
    indices: [],
  })

export interface StoredAiModelRouting {
  model_id: string
  last_selected: string | number
  failures: number
  cooldown_until: string | null
  last_error: string | null
}

export const AiModelRoutingEntity = new EntitySchema<StoredAiModelRouting>({
  name: 'AiModelRouting',
  tableName: 'ai_model_routing',
  columns: {
    model_id: { type: 'char', name: 'model_id', length: 36, primary: true },
    last_selected: { type: 'bigint', name: 'last_selected', unsigned: true },
    failures: { type: 'int', unsigned: true },
    cooldown_until: {
      type: 'datetime',
      name: 'cooldown_until',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    last_error: {
      type: 'varchar',
      name: 'last_error',
      length: 80,
      nullable: true,
    },
  },
  indices: [],
})

export interface StoredAiProviderLease {
  id: string
  provider_id: string
  expires_at: string
  model_id: string | null
}

export const AiProviderLeaseEntity = new EntitySchema<StoredAiProviderLease>({
  name: 'AiProviderLease',
  tableName: 'ai_provider_leases',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    provider_id: { type: 'char', name: 'provider_id', length: 36 },
    expires_at: {
      type: 'datetime',
      name: 'expires_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    model_id: { type: 'char', name: 'model_id', length: 36, nullable: true },
  },
  indices: [
    { name: 'model_active', columns: ['model_id', 'expires_at'] },
    { name: 'provider_active', columns: ['provider_id', 'expires_at'] },
  ],
})

export interface StoredAiProviderPool {
  provider_id: string
}

export const AiProviderPoolEntity = new EntitySchema<StoredAiProviderPool>({
  name: 'AiProviderPool',
  tableName: 'ai_provider_pools',
  columns: {
    provider_id: {
      type: 'char',
      name: 'provider_id',
      length: 36,
      primary: true,
    },
  },
  indices: [],
})
