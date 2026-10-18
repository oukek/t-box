import type { OperationsEvent } from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredNotificationWatermark {
  id: number
  started_at: string
}

export const NotificationWatermarkEntity =
  new EntitySchema<StoredNotificationWatermark>({
    name: 'NotificationWatermark',
    tableName: 'notification_watermark',
    columns: {
      id: { type: 'tinyint', primary: true },
      started_at: {
        type: 'datetime',
        name: 'started_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })

export interface StoredOperationsEvent {
  id: string
  kind: OperationsEvent['kind']
  code: string
  request_id: string | null
  task_id: string | null
  stage: string | null
  agent_id: string | null
  http_status: number | null
  duration_ms: number | null
  provider_request_id: string | null
  created_at: string
}

export const OperationsEventEntity = new EntitySchema<StoredOperationsEvent>({
  name: 'OperationsEvent',
  tableName: 'operations_events',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    kind: { type: 'varchar', length: 24 },
    code: { type: 'varchar', length: 80 },
    request_id: {
      type: 'varchar',
      name: 'request_id',
      length: 100,
      nullable: true,
    },
    task_id: { type: 'char', name: 'task_id', length: 36, nullable: true },
    stage: { type: 'varchar', length: 32, nullable: true },
    agent_id: {
      type: 'varchar',
      name: 'agent_id',
      length: 100,
      nullable: true,
    },
    http_status: { type: 'int', name: 'http_status', nullable: true },
    duration_ms: { type: 'int', name: 'duration_ms', nullable: true },
    provider_request_id: {
      type: 'varchar',
      name: 'provider_request_id',
      length: 256,
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
    { name: 'operations_recent', columns: ['created_at', 'id'] },
    { name: 'operations_task', columns: ['task_id', 'created_at'] },
  ],
})

export interface StoredUserNotification {
  id: string
  user_id: string
  source_key: string
  task_id: string
  kind: string
  read_at: string | null
  created_at: string
}

export const UserNotificationEntity = new EntitySchema<StoredUserNotification>({
  name: 'UserNotification',
  tableName: 'user_notifications',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    source_key: { type: 'varchar', name: 'source_key', length: 100 },
    task_id: { type: 'char', name: 'task_id', length: 36 },
    kind: { type: 'varchar', length: 24 },
    read_at: {
      type: 'datetime',
      name: 'read_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
  },
  indices: [
    { name: 'notification_inbox', columns: ['user_id', 'created_at', 'id'] },
    {
      name: 'notification_source',
      columns: ['user_id', 'source_key'],
      unique: true,
    },
    { name: 'task_id', columns: ['task_id'] },
  ],
})
