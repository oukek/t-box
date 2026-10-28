import assert from 'node:assert/strict'
import { createDataSource } from '../src/db/data-source.js'
import { schemaTables } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'

const source = await createDataSource().initialize()
try {
  const columns = await source.query(`SELECT TABLE_NAME AS table_name,COLUMN_NAME AS column_name,
    DATA_TYPE AS data_type,COLUMN_TYPE AS column_type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS default_value,
    CHARACTER_MAXIMUM_LENGTH AS max_length,NUMERIC_PRECISION AS number_precision,NUMERIC_SCALE AS number_scale,
    DATETIME_PRECISION AS datetime_precision FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()`)
  assert.deepEqual(source.entityMetadatas.map((e) => e.tableName).sort(), [...schemaTables(databaseSchemas).keys()].sort(), 'every business table must have typed entity metadata')
  // MySQL serializes JSON expression literals with escaped quotes and an
  // explicit utf8mb4 introducer, e.g. json_array(_utf8mb4\'1k\').
  const normalizeDefault = (value: unknown) => String(value).toLowerCase().replace(/\\'/g, '\'').replace(/\b_utf8mb4(?=')/g, '').replace(/[()'\s]/g, '')
  for (const entity of source.entityMetadatas) {
    const actual = columns.filter((column: any) => column.table_name === entity.tableName)
    assert.equal(entity.columns.length, actual.length, `${entity.tableName}: every database column needs an entity mapping`)
    for (const column of entity.columns) {
      const label = `${entity.tableName}.${column.databaseName}`
      const found = actual.find((value: any) => value.column_name === column.databaseName)
      assert.ok(found, `${label}: database column exists`)
      const type = source.driver.normalizeType(column)
      assert.equal(type, found.data_type, `${label}: SQL type`)
      assert.equal(column.isNullable, found.nullable === 'YES', `${label}: nullability`)
      if (column.length) {
        assert.equal(Number(column.length), Number(found.max_length), `${label}: text length`)
      }
      if (column.precision !== undefined) {
        assert.equal(column.precision, Number(type === 'datetime' || type === 'timestamp' ? found.datetime_precision : found.number_precision), `${label}: precision`)
      }
      if (column.scale !== undefined) {
        assert.equal(column.scale, Number(found.number_scale), `${label}: decimal scale`)
      }
      assert.equal(!!column.unsigned, /unsigned/i.test(found.column_type), `${label}: signedness`)
      if (column.enum) {
        assert.deepEqual(column.enum, [...found.column_type.matchAll(/'([^']+)'/g)].map((match: RegExpMatchArray) => match[1]), `${label}: enum values`)
      }
      // Undefined defaults delegate to MySQL. An explicit ORM default must match
      // the baseline, since QueryBuilder may include it in an INSERT itself.
      if (column.default !== undefined && column.default !== null) {
        let value = typeof column.default === 'function' ? column.default() : column.default
        if (typeof value === 'boolean') {
          value = value ? 1 : 0
        }
        const numeric = found.default_value !== null && found.default_value !== '' &&
          Number.isFinite(Number(found.default_value)) && Number(found.default_value) === Number(value)
        assert.ok(numeric || normalizeDefault(value) === normalizeDefault(found.default_value), `${label}: ORM default must match database (${String(value)} !== ${String(found.default_value)})`)
      }
    }
  }
  console.info(`ORM metadata passed: ${source.entityMetadatas.length} entities match database columns, types, lengths, signedness, precision, defaults and enums.`)
} finally {
  await source.destroy()
}
