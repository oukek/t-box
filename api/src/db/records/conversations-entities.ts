import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredConversationAnswerVersion {
  conversation_id: string
  message_id: string
  replacement_request_id: string
  revision: number
  snapshot_json: JsonDocument
  created_at: string
}

export const ConversationAnswerVersionEntity =
  new EntitySchema<StoredConversationAnswerVersion>({
    name: 'ConversationAnswerVersion',
    tableName: 'conversation_answer_versions',
    columns: {
      conversation_id: {
        type: 'char',
        name: 'conversation_id',
        length: 36,
        primary: true,
      },
      message_id: {
        type: 'char',
        name: 'message_id',
        length: 36,
        primary: true,
      },
      replacement_request_id: {
        type: 'varchar',
        name: 'replacement_request_id',
        length: 100,
        primary: true,
      },
      revision: { type: 'int', unsigned: true },
      snapshot_json: { type: 'json', name: 'snapshot_json' },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [
      {
        name: 'idx_answer_versions',
        columns: ['conversation_id', 'message_id', 'revision'],
      },
    ],
  })

export interface StoredConversation {
  id: string
  user_id: string
  title: string
  state_json: string
  resource_refs: JsonDocument
  message_count: number
  created_at: string
  updated_at: string
  revision: string | number
  title_source: 'pending' | 'generated' | 'manual'
}

export const ConversationEntity = new EntitySchema<StoredConversation>({
  name: 'Conversation',
  tableName: 'conversations',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    title: { type: 'varchar', length: 100 },
    state_json: { type: 'mediumtext', name: 'state_json' },
    resource_refs: { type: 'json', name: 'resource_refs' },
    message_count: { type: 'int', name: 'message_count' },
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
    revision: { type: 'bigint', unsigned: true },
    title_source: {
      type: 'enum',
      name: 'title_source',
      enum: ['pending', 'generated', 'manual'],
    },
  },
  indices: [
    { name: 'idx_conversation_user', columns: ['user_id', 'updated_at'] },
  ],
})
