import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import type { QueryRunner } from 'typeorm'
import { createHash } from 'node:crypto'
import { ErrorCode } from '../error-codes.js'

/** Runs under the initialization advisory lock; interrupted CREATEs can resume. */
export async function extendDatabase(runner: QueryRunner, schemas: readonly DatabaseSchema[], checkOnly = false) {
  const extensions = schemas.flatMap((schema) => schema.extensions ?? [])
  if (!extensions.length) {
    return 0
  }
  const names = new Set<string>((await runner.query('SHOW TABLES')).map((row: Record<string, string>) => Object.values(row)[0]!))
  if (!checkOnly) {
    await runner.query(`CREATE TABLE IF NOT EXISTS schema_extensions (
      id varchar(100) NOT NULL PRIMARY KEY,
      fingerprint char(64) NOT NULL,
      completed_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  }
  const applied: { id: string, fingerprint: string }[] = names.has('schema_extensions') || !checkOnly
    ? await runner.query('SELECT id,fingerprint FROM schema_extensions')
    : []
  let count = 0
  for (const extension of extensions) {
    const fingerprint = createHash('sha256').update(JSON.stringify(extension)).digest('hex')
    const current = applied.find((entry) => entry.id === extension.id)
    if (current && current.fingerprint !== fingerprint) {
      throw ErrorCode.INTERNAL_DATABASE_BASELINE_MISMATCH()
    }
    if (current) {
      const missing = extension.tables.some((sql) => !names.has(/^CREATE TABLE ([a-z_]+) \(/.exec(sql)![1]!))
      if (missing) {
        throw ErrorCode.INTERNAL_DATABASE_SCHEMA_INCOMPLETE('已完成的数据库扩展缺少表，请从备份恢复。')
      }
    } else if (!checkOnly) {
      for (const sql of extension.tables) {
        await runner.query(sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '))
      }
      await runner.query('INSERT INTO schema_extensions(id,fingerprint) VALUES(?,?)', [extension.id, fingerprint])
      count++
    }
  }
  return count
}
