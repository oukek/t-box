import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import Fastify from 'fastify'
import { createConnection } from 'mysql2/promise'
import { hashPassword } from '../src/admin/crypto.js'
import { AdminStore } from '../src/admin/store.js'
import { ApplicationBuildImports, bundleHash } from '../src/application-platform/build-import.js'
import { synchronizeImportCredential } from '../src/application-platform/import-credential.js'
import { registerApplicationBuildImports } from '../src/application-platform/import-routes.js'
import { ApplicationPublishing } from '../src/application-platform/publishing.js'
import { ApplicationPlatform } from '../src/application-platform/service.js'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { reserveSystemVersions } from '../src/system-releases/reserve.js'
import { assertDisposableDatabase } from './fixtures.js'

const config = getConfig().mysql
assertDisposableDatabase(config.database)
const database = 't_box_test_versions_' + randomUUID().replaceAll('-', '')
const { database: _database, ...options } = config
const admin = await createConnection(options)
const source = createDataSource({ ...config, database })
try {
  await admin.query('CREATE DATABASE ??', [database])
  await source.initialize()
  await initializeDatabase(source, databaseSchemas)
  const reserve = (id: number, choices: { ui?: string, core?: string }) =>
    reserveSystemVersions(source, { batch: 'test/repo/' + id, commit: 'a'.repeat(40), ...choices })
  const [first, retry] = await Promise.all([reserve(1, { ui: 'patch' }), reserve(1, { ui: 'patch' })])
  assert.deepEqual(retry, first)
  assert.equal(first.ui, '0.1.1')
  const parallel = await Promise.all([reserve(2, { ui: 'patch' }), reserve(3, { ui: 'patch' })])
  assert.deepEqual(parallel.map((r) => r.ui).sort(), ['0.1.2', '0.1.3'])
  await assert.rejects(reserve(1, { ui: 'patch' }), /批次/)
  const core = await reserve(4, { core: '1.1.15' })
  assert.equal(core.ui, null)
  await assert.rejects(reserve(4, { core: '1.1.16' }), /批次/)
  await assert.rejects(reserve(5, { ui: 'major', core: '1.1.9' }), /高于/)
  const joint = await reserve(5, { ui: 'minor', core: 'patch' })
  assert.equal(joint.ui, '0.2.0')
  assert.equal(joint.core, '1.1.16')
  assert.deepEqual(await reserve(5, { ui: 'minor', core: 'patch' }), joint)
  await new AdminStore(source).createUser('version-test', await hashPassword(randomUUID()))
  const token = randomUUID()
  await synchronizeImportCredential(source, bundleHash(token), ['calculator'])
  const app = Fastify()
  const imports = new ApplicationBuildImports(source, new ApplicationPublishing(source, new ApplicationPlatform(source, [])))
  registerApplicationBuildImports(app, source, imports)
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/system-builds/reserve',
      headers: { authorization: 'Bearer ' + token },
      payload: { batch: 'test/repo/6', commit: 'b'.repeat(40), ui: '1.1.15' },
    })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().data.ui, '1.1.15')
    assert.equal(response.headers['cache-control'], 'no-store')
  } finally {
    await app.close()
  }
  console.info('MySQL version reservations: concurrent allocation, idempotency, stale retry, independent versions and transaction rollback passed')
} finally {
  if (source.isInitialized) {
    await source.destroy()
  }
  await admin.query('DROP DATABASE IF EXISTS ??', [database])
  await admin.end()
}
