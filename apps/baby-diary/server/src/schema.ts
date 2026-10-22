import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import type { TableColumnOptions } from 'typeorm'
import { babyCareTables } from './schema-care.js'
import { babyDiarySchemaV1 } from './schema-v1.js'

export { babyDiarySchemaV1 } from './schema-v1.js'
/** Explicit whitelist for additive upgrades. App schema changes remain app-owned. */
export const babyDiaryColumnAdditions: readonly { table: string, column: TableColumnOptions }[] = [
  {
    table: 'baby_diary_babies',
    column: { name: 'theme', type: 'varchar', length: '10', isNullable: true },
  },
]
export const babyDiarySchemaV2: DatabaseSchema = {
  ...babyDiarySchemaV1,
  tables: babyDiarySchemaV1.tables.map((sql) => sql.startsWith('CREATE TABLE baby_diary_babies (')
    ? sql.replace('      `sex` varchar(10) NOT NULL,', '      `sex` varchar(10) NOT NULL,\n      `theme` varchar(10) DEFAULT NULL,')
    : sql),
}

export const babyDiarySchema: DatabaseSchema = { ...babyDiarySchemaV2, tables: [...babyDiarySchemaV2.tables, ...babyCareTables] }
