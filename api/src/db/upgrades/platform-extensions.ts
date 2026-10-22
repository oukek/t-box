import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'
import {
  babyDiaryColumnAdditions,
  babyDiarySchemaV1,
  babyDiarySchemaV2,
} from '@t-box/baby-diary-server'
import { TableColumn } from 'typeorm'
import { ErrorCode } from '../../error-codes.js'
import { DATABASE_BASELINE, schemaTables } from '../initialize.js'
import { databaseSchemas } from '../schema/index.js'

const extensions = databaseSchemas.filter((s) =>
  ['baby-diary', 'private-media', 'ai-memory'].includes(s.id),
)
const previous = databaseSchemas.filter((s) => !extensions.includes(s))
const beforeMemory = databaseSchemas.filter(
  (schema) => schema.id !== 'ai-memory',
)
const themeBabyRelease = beforeMemory.map((schema) =>
  schema.id === babyDiarySchemaV2.id ? babyDiarySchemaV2 : schema,
)
const firstBabyRelease = beforeMemory.map((schema) =>
  schema.id === babyDiarySchemaV1.id ? babyDiarySchemaV1 : schema,
)
function fingerprint(baseline: string, schemas: typeof databaseSchemas) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        baseline,
        schemas.map((s) => s.id),
        [...schemaTables(schemas)],
      ]),
    )
    .digest('hex')
}

/** Explicit, additive upgrade only. An unknown baseline is never adopted. */
export async function upgradePlatformExtensions(
  source: DataSource,
  checkOnly = false,
  options: { extensionsOnly?: boolean } = {},
) {
  const runner = source.createQueryRunner()
  let lockName = ''
  let locked = false
  try {
    await runner.connect()
    const database = source.options.database
    if (typeof database !== 'string') {
      throw ErrorCode.INTERNAL_DATABASE_BASELINE_MISMATCH()
    }
    lockName = `tbox_init_${createHash('sha256').update(database).digest('hex').slice(0, 40)}`
    // native-sql: MySQL connection-scoped advisory lock is not an entity operation.
    const locks: { acquired: number }[] = await runner.query(
      'SELECT GET_LOCK(?,30) AS acquired',
      [lockName],
    )
    if (Number(locks[0]?.acquired) !== 1) {
      throw ErrorCode.INTERNAL_DATABASE_INITIALIZATION_BUSY()
    }
    locked = true
    const hasMarker = await runner.hasTable('schema_initialization')
    if (!hasMarker && !options.extensionsOnly) {
      throw ErrorCode.INTERNAL_DATABASE_BASELINE_MISMATCH()
    }
    const row = hasMarker
      ? await runner.manager
          .createQueryBuilder()
          .select([
            's.baseline AS baseline',
            's.fingerprint AS fingerprint',
            's.state AS state',
          ])
          .from('schema_initialization', 's')
          .where('s.id=:id', { id: 1 })
          .getRawOne<{ baseline: string, fingerprint: string, state: string }>()
      : undefined
    const target = fingerprint(DATABASE_BASELINE, databaseSchemas)
    const already =
      row?.baseline === DATABASE_BASELINE && row.fingerprint === target
    const previousFingerprints = new Map([
      ['2026-10-18.1', fingerprint('2026-10-18.1', previous)],
      ['2026-10-20.1', fingerprint('2026-10-20.1', firstBabyRelease)],
      ['2026-10-21.1', fingerprint('2026-10-21.1', themeBabyRelease)],
      ['2026-10-21.2', fingerprint('2026-10-21.2', beforeMemory)],
    ])
    const knownPrevious =
      row && previousFingerprints.get(row.baseline) === row.fingerprint
    if (
      !options.extensionsOnly &&
      (!row || row.state !== 'ready' || (!already && !knownPrevious))
    ) {
      throw ErrorCode.INTERNAL_DATABASE_BASELINE_MISMATCH()
    }
    const requiredExisting =
      !options.extensionsOnly &&
      knownPrevious &&
      row?.baseline === '2026-10-20.1'
        ? firstBabyRelease
        : !options.extensionsOnly &&
          knownPrevious &&
          row?.baseline === '2026-10-21.1'
            ? themeBabyRelease
            : !options.extensionsOnly &&
              knownPrevious &&
              row?.baseline === '2026-10-21.2'
                ? beforeMemory
                : previous
    for (const name of schemaTables(requiredExisting).keys()) {
      if (!(await runner.hasTable(name))) {
        throw ErrorCode.INTERNAL_DATABASE_SCHEMA_INCOMPLETE(
          `缺少原有数据表 ${name}，请先检查备份`,
        )
      }
    }
    let additions = 0
    const plannedChanges: string[] = []
    const extensionSql = new Set(
      extensions.flatMap((schema) => [...schema.tables]),
    )
    for (const [name, sql] of [...schemaTables(databaseSchemas)].filter(
      ([, sql]) => extensionSql.has(sql),
    )) {
      const table = await runner.getTable(name)
      if (table) {
        // Resumable DDL: compare existing extension columns and primary key to entity metadata.
        const metadata = source.entityMetadatas.find(
          (m) => m.tableName === name,
        )
        const missing =
          metadata?.columns.filter(
            (column) => !table.findColumnByName(column.databaseName),
          ) ?? []
        const permitted = [
          ...babyDiaryColumnAdditions,
          {
            table: 'ai_memory_states',
            column: {
              name: 'auto_since',
              type: 'datetime',
              precision: 3,
              isNullable: true,
            },
          },
        ].filter(
          (addition) =>
            addition.table === name &&
            missing.some(
              (column) => column.databaseName === addition.column.name,
            ),
        )
        if (
          !metadata ||
          table.columns.length !== metadata.columns.length - missing.length ||
          missing.some(
            (column) =>
              !permitted.some(
                (addition) => addition.column.name === column.databaseName,
              ),
          ) ||
          metadata.columns.some((column) => {
            const actual = table.findColumnByName(column.databaseName)
            if (!actual) {
              return false // Missing columns were checked against the app-owned whitelist above.
            }
            return (
              actual.type !== source.driver.normalizeType(column) ||
              (!!column.length && actual.length !== column.length) ||
              actual.unsigned !== !!column.unsigned ||
              actual.isNullable !== column.isNullable ||
              actual.isPrimary !== column.isPrimary
            )
          })
        ) {
          throw ErrorCode.INTERNAL_DATABASE_BASELINE_MISMATCH()
        }
        if (missing.length && already && !options.extensionsOnly) {
          throw ErrorCode.INTERNAL_DATABASE_SCHEMA_INCOMPLETE(
            `缺少 ${name} 的新增字段`,
          )
        }
        for (const addition of permitted) {
          plannedChanges.push(`${name}.${addition.column.name}`)
          if (!checkOnly) {
            await runner.addColumn(name, new TableColumn(addition.column))
            additions++
          }
        }
      } else if (already && !options.extensionsOnly) {
        throw ErrorCode.INTERNAL_DATABASE_SCHEMA_INCOMPLETE(
          `缺少新增数据表 ${name}`,
        )
      } else {
        plannedChanges.push(name)
        if (!checkOnly) {
          await runner.query(sql)
          additions++
        }
      }
    }
    if (!already && !checkOnly && !options.extensionsOnly) {
      await runner.manager
        .createQueryBuilder()
        .update('schema_initialization')
        .set({
          baseline: DATABASE_BASELINE,
          fingerprint: target,
          completed_at: () => 'UTC_TIMESTAMP(3)',
        })
        .where('id=:id', { id: 1 })
        .execute()
    }
    return {
      changed: options.extensionsOnly ? additions > 0 : !already && !checkOnly,
      checkOnly,
      baseline: options.extensionsOnly ? null : DATABASE_BASELINE,
      extension: 'platform-extensions@2026-10-22.1',
      plannedChanges,
    }
  } finally {
    try {
      if (locked) {
        // native-sql: release the same connection-scoped MySQL advisory lock.
        await runner.query('SELECT RELEASE_LOCK(?)', [lockName])
      }
    } finally {
      await runner.release()
    }
  }
}
