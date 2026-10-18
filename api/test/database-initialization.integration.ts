import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createLedgerRows } from '@t-box/ledger-server/ledgers/create'
import { createConnection } from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { DATABASE_BASELINE, initializeDatabase, schemaTables } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { IdentityService } from '../src/identity/service.js'

const config = getConfig().mysql
if (!/^t_box_(?:ci|test_[a-z0-9_]+)$/.test(config.database)) {
  throw new Error('Set MYSQL_DATABASE=t_box_test_init (disposable test environment only)')
}
const { database: _database, ...options } = config
const admin = await createConnection(options)
const created: string[] = []
const sources: ReturnType<typeof createDataSource>[] = []

async function freshDatabase() {
  const name = `t_box_test_init_${randomUUID().replaceAll('-', '')}`
  // Reproduces the failing CI default: application tables must not inherit it.
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
  created.push(name)
  const source = await createDataSource({ ...config, database: name }).initialize()
  sources.push(source)
  return source
}
async function scalar(source: ReturnType<typeof createDataSource>, sql: string) {
  const [row] = await source.query(sql)
  return Object.values(row)[0]
}

try {
  const fresh = await freshDatabase()
  const result = await initializeDatabase(fresh, databaseSchemas)
  assert.equal(result.initialized, true)
  assert.equal(result.baseline, DATABASE_BASELINE)
  assert.equal(result.tables, 92)
  const expected = [...schemaTables(databaseSchemas).keys(), 'schema_initialization'].sort()
  assert.deepEqual((await fresh.query('SHOW TABLES')).map((row: Record<string, string>) => Object.values(row)[0]).sort(), expected)
  const collations = await fresh.query(`SELECT TABLE_NAME FROM information_schema.TABLES
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_COLLATION<>'utf8mb4_unicode_ci'`)
  assert.deepEqual(collations, [])
  const characterColumns = await fresh.query(`SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND COLLATION_NAME IS NOT NULL AND COLLATION_NAME<>'utf8mb4_unicode_ci'`)
  assert.deepEqual(characterColumns, [])
  for (const name of ['ledgers', 'bills', 'app_users', 'admin_users']) {
    assert.equal(Number(await scalar(fresh, `SELECT COUNT(*) FROM ${name}`)), 0)
  }
  assert.equal(Number(await scalar(fresh, 'SELECT COUNT(*) FROM ledger_category_presets')), 10)
  assert.equal(Number(await scalar(fresh, 'SELECT COUNT(*) FROM ai_models')), 0)
  const [{ published }] = await fresh.query('SELECT published FROM calendar_holiday_years WHERE region=\'CN\' AND year=2026')
  assert.equal((typeof published === 'string' ? JSON.parse(published) : published).year, 2026)

  // Existing application code can register a user and create FK-linked book categories.
  const identity = new IdentityService(fresh, (db, userId) => createLedgerRows(db, userId, { name: '初始化回归账本', template: 'daily' }))
  await identity.register({ username: 'init_fixture', password: 'test123' }, 'init-fixture')
  assert.equal(Number(await scalar(fresh, 'SELECT COUNT(*) FROM bill_categories')), 10)
  await fresh.query('UPDATE ledger_category_presets SET label=\'自定义系统分类\' WHERE type=\'expense\' AND label=\'餐饮\'')
  await fresh.query('UPDATE recharge_settings SET configuration=JSON_SET(configuration,\'$.customEnabled\',TRUE)')
  const [settingsBefore] = await fresh.query('SELECT * FROM recharge_settings')
  const repeated = await initializeDatabase(fresh, databaseSchemas)
  assert.equal(repeated.initialized, false)
  assert.equal(await scalar(fresh, 'SELECT label FROM ledger_category_presets WHERE label=\'自定义系统分类\''), '自定义系统分类')
  assert.deepEqual((await fresh.query('SELECT * FROM recharge_settings'))[0], settingsBefore)
  assert.equal(Number(await scalar(fresh, 'SELECT COUNT(*) FROM app_users')), 1)

  // An interrupted seed transaction leaves DDL resumable and no partial defaults.
  const interrupted = await freshDatabase()
  const failing: DatabaseSchema[] = databaseSchemas.map((schema) => schema.id !== 'ledger'
    ? schema
    : {
        ...schema,
        async seed(db) {
          await schema.seed!(db)
          throw new Error('fixture initialization interrupted')
        },
      })
  await assert.rejects(initializeDatabase(interrupted, failing), /fixture initialization interrupted/)
  assert.equal(await scalar(interrupted, 'SELECT state FROM schema_initialization'), 'initializing')
  assert.equal(Number(await scalar(interrupted, 'SELECT COUNT(*) FROM ai_settings')), 0)
  assert.equal(Number(await scalar(interrupted, 'SELECT COUNT(*) FROM ledger_category_presets')), 0)
  const resumed = await initializeDatabase(interrupted, databaseSchemas)
  assert.equal(resumed.initialized, true)
  assert.equal(Number(await scalar(interrupted, 'SELECT COUNT(*) FROM ledger_category_presets')), 10)

  // A failed legacy migration must never be mistaken for a new baseline.
  const legacy = await freshDatabase()
  await legacy.query('CREATE TABLE bills(id INT PRIMARY KEY,note VARCHAR(40))')
  await legacy.query('INSERT INTO bills VALUES(1,\'保留原始数据\')')
  await assert.rejects(initializeDatabase(legacy, databaseSchemas), /已有旧表/)
  assert.equal(await scalar(legacy, 'SELECT note FROM bills WHERE id=1'), '保留原始数据')
  assert.equal((await legacy.query('SHOW TABLES')).length, 1)

  // Initializers serialize per database, including two independent connections.
  const concurrent = await freshDatabase()
  const peer = await createDataSource({ ...config, database: created.at(-1)! }).initialize()
  sources.push(peer)
  const results = await Promise.all([
    initializeDatabase(concurrent, databaseSchemas),
    initializeDatabase(peer, databaseSchemas),
  ])
  assert.deepEqual(results.map((r) => r.initialized).sort(), [false, true])
  assert.equal(Number(await scalar(concurrent, 'SELECT COUNT(*) FROM ledger_category_presets')), 10)
  await concurrent.query('UPDATE schema_initialization SET fingerprint=REPEAT(\'0\',64)')
  await assert.rejects(initializeDatabase(concurrent, databaseSchemas), /版本与当前代码不一致/)
  console.info('Database init passed: MySQL 8 defaults, all tables/FKs/seeds, user book creation, repeat safety, interruption recovery, legacy data protection, concurrent initialization and baseline fencing.')
} finally {
  for (const source of sources) {
    await source.destroy()
  }
  try {
    for (const name of created) {
      await admin.query(`DROP DATABASE \`${name}\``)
    }
  } finally {
    await admin.end()
  }
}
