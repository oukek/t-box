import type {
  ConfigurationSnapshot,
  MemoryKind,
  MemoryStatus,
} from '@t-box/shared'
import type { ModelRequestRecord } from '../../agent/model-retry.js'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

export interface MemoryStateRow {
  userId: string
  enabled: boolean
  autoExtract: boolean
  autoSince: string | null
  revision: number
  epoch: number
}
export interface MemoryRow {
  id: string
  userId: string
  slot: string
  label: string
  content: string
  kind: MemoryKind
  status: MemoryStatus
  origin: 'manual' | 'conversation' | 'extracted'
  version: number
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}
export interface MemorySourceRow {
  memoryId: string
  conversationId: string
  messageId: string
  contentHash: string
  excerpt: string
}
export interface MemoryJobRow {
  id: string
  userId: string
  conversationId: string
  messageId: string
  contentHash: string
  epoch: number
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'
  availableAt: string
  leaseUntil: string | null
  owner: string | null
  error: string | null
  state: {
    configuration?: ConfigurationSnapshot
    requests?: Record<string, ModelRequestRecord>
    modelKey?: string
    existing?: {
      slot: string
      label: string
      kind: MemoryKind
      content: string
    }[]
  }
  createdAt: string
}
const time = {
  type: 'datetime' as const,
  precision: 3,
  transformer: utcSqlDateTime,
}
const userKey = {
  target: 'AppUser',
  columnNames: ['userId'],
  referencedColumnNames: ['id'],
  onDelete: 'CASCADE' as const,
}
export const MemoryStateEntity = new EntitySchema<MemoryStateRow>({
  name: 'AiMemoryState',
  tableName: 'ai_memory_states',
  columns: {
    userId: { type: 'char', length: 36, name: 'user_id', primary: true },
    enabled: { type: Boolean, default: true },
    autoExtract: { type: Boolean, name: 'auto_extract', default: false },
    autoSince: { ...time, name: 'auto_since', nullable: true },
    revision: { type: 'int', default: 1, unsigned: true },
    epoch: { type: 'int', default: 1, unsigned: true },
  },
  foreignKeys: [userKey],
})
export const MemoryEntity = new EntitySchema<MemoryRow>({
  name: 'AiMemory',
  tableName: 'ai_memories',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    userId: { type: 'char', length: 36, name: 'user_id' },
    slot: { type: 'varchar', length: 80 },
    label: { type: 'varchar', length: 80 },
    content: { type: 'varchar', length: 800 },
    kind: { type: 'varchar', length: 20 },
    status: { type: 'varchar', length: 16 },
    origin: { type: 'varchar', length: 20 },
    version: { type: 'int', unsigned: true, default: 1 },
    createdAt: { ...time, name: 'created_at' },
    updatedAt: { ...time, name: 'updated_at' },
    expiresAt: { ...time, nullable: true, name: 'expires_at' },
  },
  indices: [
    { columns: ['userId', 'slot', 'status'], unique: true },
    { columns: ['userId', 'status', 'updatedAt'] },
  ],
  foreignKeys: [userKey],
})
export const MemorySourceEntity = new EntitySchema<MemorySourceRow>({
  name: 'AiMemorySource',
  tableName: 'ai_memory_sources',
  columns: {
    memoryId: { type: 'char', length: 36, name: 'memory_id', primary: true },
    conversationId: {
      type: 'char',
      length: 36,
      name: 'conversation_id',
      primary: true,
    },
    messageId: {
      type: 'varchar',
      length: 100,
      name: 'message_id',
      primary: true,
    },
    contentHash: { type: 'char', length: 64, name: 'content_hash' },
    excerpt: { type: 'varchar', length: 200 },
  },
  foreignKeys: [
    {
      target: 'AiMemory',
      columnNames: ['memoryId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
  indices: [{ columns: ['conversationId', 'messageId'] }],
})
export const MemoryJobEntity = new EntitySchema<MemoryJobRow>({
  name: 'AiMemoryJob',
  tableName: 'ai_memory_jobs',
  columns: {
    id: { type: 'char', length: 64, primary: true },
    userId: { type: 'char', length: 36, name: 'user_id' },
    conversationId: { type: 'char', length: 36, name: 'conversation_id' },
    messageId: { type: 'varchar', length: 100, name: 'message_id' },
    contentHash: { type: 'char', length: 64, name: 'content_hash' },
    epoch: { type: 'int', unsigned: true },
    status: { type: 'varchar', length: 16 },
    availableAt: { ...time, name: 'available_at' },
    leaseUntil: { ...time, nullable: true, name: 'lease_until' },
    owner: { type: 'char', length: 36, nullable: true },
    error: { type: 'varchar', length: 240, nullable: true },
    state: { type: 'json' },
    createdAt: { ...time, name: 'created_at' },
  },
  indices: [
    { columns: ['status', 'availableAt'] },
    { columns: ['userId', 'conversationId'] },
  ],
  foreignKeys: [userKey],
})
export const memoryEntities = [
  MemoryStateEntity,
  MemoryEntity,
  MemorySourceEntity,
  MemoryJobEntity,
]
