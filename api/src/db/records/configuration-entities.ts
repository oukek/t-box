import type { JsonDocument } from '@t-box/server-foundation/persistence/columns'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredPlatformConfigurationHistory {
  config_key: string
  revision: string | number
  value_json: JsonDocument
  administrator_id: string | null
  note: string
  created_at: string
}

export const PlatformConfigurationHistoryEntity =
  new EntitySchema<StoredPlatformConfigurationHistory>({
    name: 'PlatformConfigurationHistory',
    tableName: 'platform_configuration_history',
    columns: {
      config_key: {
        type: 'varchar',
        name: 'config_key',
        length: 190,
        primary: true,
      },
      revision: { type: 'bigint', primary: true },
      value_json: { type: 'json', name: 'value_json' },
      administrator_id: {
        type: 'char',
        name: 'administrator_id',
        length: 36,
        nullable: true,
      },
      note: { type: 'varchar', length: 500 },
      created_at: {
        type: 'datetime',
        name: 'created_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })

export interface StoredPlatformConfigurationState {
  id: number
  revision: string | number
  ai_revision: string | number
}

export const PlatformConfigurationStateEntity =
  new EntitySchema<StoredPlatformConfigurationState>({
    name: 'PlatformConfigurationState',
    tableName: 'platform_configuration_state',
    columns: {
      id: { type: 'tinyint', primary: true },
      revision: { type: 'bigint' },
      ai_revision: { type: 'bigint', name: 'ai_revision' },
    },
    indices: [],
  })

export interface StoredPlatformConfiguration {
  config_key: string
  definition_json: JsonDocument
  value_json: JsonDocument
  updated_at: string
}

export const PlatformConfigurationEntity =
  new EntitySchema<StoredPlatformConfiguration>({
    name: 'PlatformConfiguration',
    tableName: 'platform_configurations',
    columns: {
      config_key: {
        type: 'varchar',
        name: 'config_key',
        length: 190,
        primary: true,
      },
      definition_json: { type: 'json', name: 'definition_json' },
      value_json: { type: 'json', name: 'value_json' },
      updated_at: {
        type: 'datetime',
        name: 'updated_at',
        precision: 3,
        transformer: utcSqlDateTime,
      },
    },
    indices: [],
  })
