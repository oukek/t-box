import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { babyDiarySchemaV1, babyDiarySchemaV2 } from '@t-box/baby-diary-server'
import { createConnection } from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import {
  DATABASE_BASELINE,
  initializeDatabase,
  schemaTables,
} from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { upgradeBabyDiary } from '../src/db/upgrades/baby-diary.js'

const config = getConfig().mysql
if (!/^t_box_test_[a-z0-9_]+$/.test(config.database)) {
  throw new Error('Use a disposable test database')
}
const name = `t_box_test_baby_upgrade_${randomUUID().replaceAll('-', '').slice(0, 10)}`
const { database: _, ...options } = config
const admin = await createConnection(options)
await admin.query(
  `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
)
const source = await createDataSource({
  ...config,
  database: name,
}).initialize()
try {
  const legacy = databaseSchemas.filter(
    (schema) => !['baby-diary', 'private-media'].includes(schema.id),
  )
  await initializeDatabase(source, legacy)
  const legacyFingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        '2026-10-18.1',
        legacy.map((s) => s.id),
        [...schemaTables(legacy)],
      ]),
    )
    .digest('hex')
  await source.query(
    'UPDATE schema_initialization SET baseline=?,fingerprint=? WHERE id=1',
    ['2026-10-18.1', legacyFingerprint],
  )
  await source.query(
    'UPDATE recharge_settings SET configuration=JSON_SET(configuration,\'$.customEnabled\',TRUE)',
  )
  const before = await source.query(
    'SELECT id,configuration FROM recharge_settings',
  )
  assert.equal((await upgradeBabyDiary(source, true)).changed, false)
  const check = source.createQueryRunner()
  try {
    assert.equal(await check.hasTable('baby_diary_babies'), false)
  } finally {
    await check.release()
  }
  assert.equal((await upgradeBabyDiary(source)).changed, true)
  assert.deepEqual(
    await source.query('SELECT id,configuration FROM recharge_settings'),
    before,
  )
  assert.equal(
    (await initializeDatabase(source, databaseSchemas)).initialized,
    false,
  )
  assert.equal((await upgradeBabyDiary(source)).changed, false)
  // Simulate the first complete baby release, including an existing profile.
  const firstBabySchemas = databaseSchemas.map((schema) => schema.id === babyDiarySchemaV1.id ? babyDiarySchemaV1 : schema)
  const firstBabyFingerprint = createHash('sha256').update(JSON.stringify([
    '2026-10-20.1',
    firstBabySchemas.map((s) => s.id),
    [...schemaTables(firstBabySchemas)],
  ])).digest('hex')
  const runner = source.createQueryRunner()
  const existingBabyId = randomUUID()
  try {
    const careTables = ['baby_diary_care', 'baby_diary_feedings', 'baby_diary_diapers', 'baby_diary_care_revisions']
    for (const table of careTables) {
      await runner.dropTable(table)
    }
    await runner.dropColumn('baby_diary_babies', 'theme')
    await source.query('UPDATE schema_initialization SET baseline=?,fingerprint=? WHERE id=1', ['2026-10-20.1', firstBabyFingerprint])
    await source.query(
      'INSERT INTO baby_diary_babies (id,name,birth_date,sex,timezone,owner_subject,archived,revision,created_at,updated_at) VALUES (?, ?, NULL, ?, ?, ?, FALSE, 7, NOW(3), NOW(3))',
      [existingBabyId, '保留的档案', 'female', 'Asia/Shanghai', 'b'.repeat(64)],
    )
    await source.query('DROP TABLE baby_diary_actors')
    await assert.rejects(upgradeBabyDiary(source), /缺少原有数据表 baby_diary_actors/)
    await source.query(schemaTables([babyDiarySchemaV1]).get('baby_diary_actors')!)
    const themePreflight = await upgradeBabyDiary(source, true)
    assert.deepEqual(themePreflight.plannedChanges, ['baby_diary_babies.theme', ...careTables])
    assert.equal((await runner.getTable('baby_diary_babies'))?.findColumnByName('theme'), undefined)
    assert.equal((await upgradeBabyDiary(source)).changed, true)
    assert.deepEqual(await source.query('SELECT name,sex,theme,revision FROM baby_diary_babies WHERE id=?', [existingBabyId]), [
      { name: '保留的档案', sex: 'female', theme: null, revision: 7 },
    ])
    assert.equal((await upgradeBabyDiary(source)).changed, false)
    assert.equal((await initializeDatabase(source, databaseSchemas)).initialized, false)
    // The immediately preceding themed release gains only care tables, retaining all existing profiles and grants.
    for (const table of careTables) {
      await runner.dropTable(table)
    }
    const themed = databaseSchemas.map((schema) => schema.id === babyDiarySchemaV2.id ? babyDiarySchemaV2 : schema)
    const themeFingerprint = createHash('sha256').update(JSON.stringify(['2026-10-21.1', themed.map((schema) => schema.id), [...schemaTables(themed)]])).digest('hex')
    await source.query('UPDATE schema_initialization SET baseline=?,fingerprint=? WHERE id=1', ['2026-10-21.1', themeFingerprint])
    assert.deepEqual((await upgradeBabyDiary(source, true)).plannedChanges, careTables)
    assert.equal((await upgradeBabyDiary(source)).changed, true)
    assert.equal((await initializeDatabase(source, databaseSchemas)).initialized, false)
    assert.deepEqual(await source.query('SELECT name,sex,theme,revision FROM baby_diary_babies WHERE id=?', [existingBabyId]), [{ name: '保留的档案', sex: 'female', theme: null, revision: 7 }])
  } finally {
    await runner.release()
  }
  assert.equal(
    (
      await source.query(
        'SELECT baseline FROM schema_initialization WHERE id=1',
      )
    )[0].baseline,
    DATABASE_BASELINE,
  )
  await source.query(
    'UPDATE schema_initialization SET fingerprint=? WHERE id=1',
    ['0'.repeat(64)],
  )
  await assert.rejects(upgradeBabyDiary(source), /初始化版本/)
  // Legacy host databases may add this isolated extension without claiming or rewriting the host baseline.
  for (const name of [
    ...schemaTables(
      databaseSchemas.filter((schema) =>
        ['baby-diary', 'private-media'].includes(schema.id),
      ),
    ).keys(),
  ].reverse()) {
    await source.query(`DROP TABLE ${name}`)
  }
  await source.query('DROP TABLE schema_initialization')
  await source.query(
    'CREATE TABLE schema_migrations(id INT PRIMARY KEY, note VARCHAR(80))',
  )
  await source.query(
    'INSERT INTO schema_migrations VALUES(1,\'preserve legacy marker\')',
  )
  await assert.rejects(upgradeBabyDiary(source))
  assert.equal(
    (await upgradeBabyDiary(source, true, { extensionsOnly: true })).changed,
    false,
  )
  assert.equal(
    (await upgradeBabyDiary(source, false, { extensionsOnly: true })).changed,
    true,
  )
  assert.equal(
    (await upgradeBabyDiary(source, false, { extensionsOnly: true })).changed,
    false,
  )
  assert.equal(
    (await source.query('SELECT note FROM schema_migrations WHERE id=1'))[0]
      .note,
    'preserve legacy marker',
  )
  assert.deepEqual(
    await source.query('SELECT id,configuration FROM recharge_settings'),
    before,
  )
  const legacyRunner = source.createQueryRunner()
  try {
    await legacyRunner.dropColumn('baby_diary_babies', 'theme')
    assert.deepEqual((await upgradeBabyDiary(source, true, { extensionsOnly: true })).plannedChanges, ['baby_diary_babies.theme'])
    assert.equal((await upgradeBabyDiary(source, false, { extensionsOnly: true })).changed, true)
    await source.query('ALTER TABLE baby_diary_babies MODIFY theme VARCHAR(5) NULL')
    await assert.rejects(upgradeBabyDiary(source, false, { extensionsOnly: true }), /初始化版本/)
  } finally {
    await legacyRunner.release()
  }
  await assert.rejects(initializeDatabase(source, databaseSchemas))
  process.stdout.write(
    'Baby diary additive upgrade passed: preflight, preserved configuration, idempotence and unknown-baseline rejection.\n',
  )
} finally {
  await source.destroy()
  await admin.query(`DROP DATABASE \`${name}\``)
  await admin.end()
}
