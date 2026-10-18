import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredAiWorkflowConfiguration {
  revision: number
  prompts_json: JsonDocument
  administrator_id: string | null
  created_at: string
}

export const AiWorkflowConfigurationEntity =
  new EntitySchema<StoredAiWorkflowConfiguration>({
    name: 'AiWorkflowConfiguration',
    tableName: 'ai_workflow_configurations',
    columns: {
      revision: { type: 'int', primary: true },
      prompts_json: { type: 'json', name: 'prompts_json' },
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
    indices: [],
  })

export interface StoredAiWorkflowSetting {
  id: number
  revision: number
}

export const AiWorkflowSettingEntity =
  new EntitySchema<StoredAiWorkflowSetting>({
    name: 'AiWorkflowSetting',
    tableName: 'ai_workflow_settings',
    columns: {
      id: { type: 'tinyint', primary: true },
      revision: { type: 'int' },
    },
    indices: [{ name: 'fk_workflow_revision', columns: ['revision'] }],
  })
