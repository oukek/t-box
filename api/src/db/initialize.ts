import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import type { DataSource } from 'typeorm'
import { createHash } from 'node:crypto'

export const DATABASE_BASELINE = '2026-10-18.1'
const marker = 'schema_initialization'

/** Order trusted, static CREATE statements without disabling foreign-key checks. */
export function schemaTables(schemas: readonly DatabaseSchema[]) {
  const tables = new Map<string, string>()
  for (const schema of schemas) {
    for (const sql of schema.tables) {
      const name = /^CREATE TABLE ([a-z_]+) \(/.exec(sql)?.[1]
      if (!name || tables.has(name) || !sql.endsWith('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')) {
        throw new Error(`Invalid or duplicate table in schema ${schema.id}`)
      }
      tables.set(name, sql)
    }
  }
  const ordered = new Map<string, string>()
  const visiting = new Set<string>()
  function visit(name: string) {
    if (ordered.has(name)) {
      return
    }
    const sql = tables.get(name)
    if (!sql || visiting.has(name)) {
      throw new Error(`Missing or circular schema dependency: ${name}`)
    }
    visiting.add(name)
    for (const match of sql.matchAll(/REFERENCES ([a-z_]+) \(/g)) {
      if (match[1] !== name) {
        visit(match[1]!)
      }
    }
    visiting.delete(name)
    ordered.set(name, sql)
  }
  for (const name of tables.keys()) {
    visit(name)
  }
  return ordered
}

/** Fresh installation only. Never alters, drops or adopts an unknown existing schema. */
export async function initializeDatabase(source: DataSource, schemas: readonly DatabaseSchema[]) {
  const tables = schemaTables(schemas)
  const fingerprint = createHash('sha256')
    .update(JSON.stringify([DATABASE_BASELINE, schemas.map((s) => s.id), [...tables]]))
    .digest('hex')
  const runner = source.createQueryRunner()
  let locked = false
  let lockName = ''
  try {
    await runner.connect()
    const [{ name }] = await runner.query('SELECT DATABASE() AS name')
    lockName = `tbox_init_${createHash('sha256').update(name).digest('hex').slice(0, 40)}`
    const [lock] = await runner.query('SELECT GET_LOCK(?,30) AS acquired', [lockName])
    if (Number(lock?.acquired) !== 1) {
      throw new Error('无法获取数据库初始化锁，请稍后重试')
    }
    locked = true
    const names = (await runner.query('SHOW TABLES')).map((row: Record<string, string>) => Object.values(row)[0])
    const unknownDatabase = () => new Error(
      '当前数据库已有旧表或未识别的结构，初始化已停止，未清空数据。请将 MYSQL_DATABASE 指向一个新数据库后重试；旧库请先备份，有数据的库不能用首次初始化代替升级。详见 docs/database-initialization.md。',
    )
    if (!names.includes(marker) && names.length) {
      throw unknownDatabase()
    }
    await runner.query(`CREATE TABLE IF NOT EXISTS ${marker} (
      id TINYINT NOT NULL PRIMARY KEY,
      baseline VARCHAR(32) NOT NULL,
      fingerprint CHAR(64) NOT NULL,
      state ENUM('initializing','ready') NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      completed_at DATETIME(3) NULL,
      CONSTRAINT single_schema_initialization CHECK(id=1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    const [current] = await runner.query(`SELECT baseline,fingerprint,state FROM ${marker} WHERE id=1`)
    if (!current && names.some((name: string) => name !== marker)) {
      throw unknownDatabase()
    }
    if (current && (current.baseline !== DATABASE_BASELINE || current.fingerprint !== fingerprint)) {
      throw new Error('数据库初始化版本与当前代码不一致，不能覆盖已有结构。请使用匹配的发布版本或正式升级脚本。')
    }
    if (current?.state === 'ready') {
      const missing = [...tables.keys()].filter((name) => !names.includes(name))
      if (missing.length) {
        throw new Error(`数据库初始化记录已完成但缺少表：${missing.join(', ')}。请检查备份，不能按空库重新初始化。`)
      }
      return { initialized: false, tables: tables.size, baseline: DATABASE_BASELINE }
    }
    if (!current) {
      await runner.query(`INSERT INTO ${marker}(id,baseline,fingerprint,state) VALUES(1,?,?,'initializing')`, [DATABASE_BASELINE, fingerprint])
    }
    // MySQL DDL auto-commits. The marker is persisted first so this exact baseline
    // can resume after interruption; all default rows commit together afterwards.
    for (const sql of tables.values()) {
      await runner.query(sql.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS '))
    }
    await runner.startTransaction()
    try {
      for (const schema of schemas) {
        await schema.seed?.(runner)
      }
      await runner.query(`UPDATE ${marker} SET state='ready',completed_at=UTC_TIMESTAMP(3) WHERE id=1`)
      await runner.commitTransaction()
    } catch (error) {
      await runner.rollbackTransaction()
      throw error
    }
    return { initialized: true, tables: tables.size, baseline: DATABASE_BASELINE }
  } finally {
    try {
      if (locked) {
        await runner.query('SELECT RELEASE_LOCK(?)', [lockName])
      }
    } finally {
      await runner.release()
    }
  }
}
