import type { TaskStatus, TaskToolRecord } from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredAgentTaskTool {
  task_id: string
  call_id: string
  name: string
  agent_id: string
  fingerprint: string
  effect: string
  status: TaskToolRecord['status']
  result_json: string | null
  updated_at: string
  execution_key: string | null
}

export const AgentTaskToolEntity = new EntitySchema<StoredAgentTaskTool>({
  name: 'AgentTaskTool',
  tableName: 'agent_task_tools',
  columns: {
    task_id: { type: 'char', name: 'task_id', length: 36, primary: true },
    call_id: { type: 'varchar', name: 'call_id', length: 100, primary: true },
    name: { type: 'varchar', length: 64 },
    agent_id: { type: 'varchar', name: 'agent_id', length: 64 },
    fingerprint: { type: 'char', length: 64 },
    effect: { type: 'varchar', length: 24 },
    status: { type: 'varchar', length: 24 },
    result_json: { type: 'mediumtext', name: 'result_json', nullable: true },
    updated_at: {
      type: 'datetime',
      name: 'updated_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    execution_key: {
      type: 'char',
      name: 'execution_key',
      length: 64,
      nullable: true,
    },
  },
  indices: [
    {
      name: 'task_effect_once',
      columns: ['task_id', 'execution_key'],
      unique: true,
    },
  ],
})

export interface StoredAgentTask {
  id: string
  user_id: string
  conversation_id: string
  request_id: string
  status: TaskStatus
  active_key: string | null
  agent_id: string
  checkpoint_json: string
  lease_owner: string | null
  lease_until: string | null
  cancel_requested: number | boolean
  reason: string | null
  created_at: string
  updated_at: string
  recovery_auth_hash: string | null
  recovery_ready: number | boolean
  recovery_attempts: number
  recovery_after: string | null
  recovery_claim: string | null
  recovery_claim_until: string | null
}

export const AgentTaskEntity = new EntitySchema<StoredAgentTask>({
  name: 'AgentTask',
  tableName: 'agent_tasks',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    conversation_id: { type: 'char', name: 'conversation_id', length: 36 },
    request_id: { type: 'varchar', name: 'request_id', length: 100 },
    status: { type: 'varchar', length: 24 },
    active_key: {
      type: 'char',
      name: 'active_key',
      length: 36,
      nullable: true,
    },
    agent_id: { type: 'varchar', name: 'agent_id', length: 64 },
    checkpoint_json: {
      type: 'mediumtext',
      name: 'checkpoint_json',
      select: false,
    },
    lease_owner: {
      type: 'char',
      name: 'lease_owner',
      length: 36,
      nullable: true,
    },
    lease_until: {
      type: 'datetime',
      name: 'lease_until',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    cancel_requested: { type: 'tinyint', name: 'cancel_requested' },
    reason: { type: 'varchar', length: 200, nullable: true },
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
    recovery_auth_hash: {
      type: 'char',
      name: 'recovery_auth_hash',
      length: 64,
      nullable: true,
      select: false,
    },
    recovery_ready: { type: 'tinyint', name: 'recovery_ready' },
    recovery_attempts: {
      type: 'int',
      name: 'recovery_attempts',
      unsigned: true,
    },
    recovery_after: {
      type: 'datetime',
      name: 'recovery_after',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    recovery_claim: {
      type: 'char',
      name: 'recovery_claim',
      length: 36,
      nullable: true,
    },
    recovery_claim_until: {
      type: 'datetime',
      name: 'recovery_claim_until',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [
    { name: 'active_key', columns: ['active_key'], unique: true },
    { name: 'task_background', columns: ['recovery_ready', 'recovery_after'] },
    { name: 'task_recovery', columns: ['status', 'lease_until'] },
    {
      name: 'task_request',
      columns: ['conversation_id', 'request_id'],
      unique: true,
    },
    { name: 'task_updated', columns: ['updated_at', 'id'] },
    { name: 'task_user', columns: ['user_id', 'updated_at'] },
  ],
})
