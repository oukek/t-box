import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { createConnection } from 'mysql2/promise'
import { getConfig } from '../src/config.js'
import { createDataSource } from '../src/db/data-source.js'
import { initializeDatabase } from '../src/db/initialize.js'
import { databaseSchemas } from '../src/db/schema/index.js'
import { reserveSystemVersions } from '../src/system-releases/reserve.js'
import { listWebCandidates, promoteWebCandidate, registerWebCandidate } from '../src/system-releases/web-candidates.js'
import { assertDisposableDatabase } from './fixtures.js'

const config = getConfig().mysql
assertDisposableDatabase(config.database)
const database = 't_box_test_release_' + randomUUID().replaceAll('-', '')
const { database: _database, ...options } = config
const admin = await createConnection(options)
const source = createDataSource({ ...config, database })
const objects = new Map<string, Buffer>()
const writes: string[] = []
let fault = ''
const storage = {
  async read(key: string) {
    return objects.get(key)!
  },
  async write(key: string, content: Buffer) {
    if (key === fault) {
      throw new Error('injected interruption')
    }
    writes.push(key)
    objects.set(key, content)
  },
}
async function prepare(id: number, extra = 'asset.js') {
  const { build, ui: version } = await reserveSystemVersions(source, { batch: 'fixture/repo/' + id, commit: 'a'.repeat(40), ui: 'patch' })
  const files = [
    { path: 'web-version.json', value: JSON.stringify({ build, version }) },
    { path: 'index.html', value: '<html>fixture</html>' },
    { path: 'tbox-offline-sw.js', value: '/* worker */' },
    { path: extra, value: '/* fixture */' },
  ]
  const bytes = Buffer.from(JSON.stringify(files.map((f) => ({ path: f.path, content: Buffer.from(f.value).toString('base64') }))))
  const digest = createHash('sha256').update(bytes).digest('hex')
  objects.set('system-candidates/' + build + '/' + digest + '.json', bytes)
  return { build, digest }
}
try {
  await admin.query('CREATE DATABASE ??', [database])
  await source.initialize()
  await initializeDatabase(source, databaseSchemas)
  const first = await prepare(1)
  await Promise.all([registerWebCandidate(source, first, storage), registerWebCandidate(source, first, storage)])
  await assert.rejects(registerWebCandidate(source, await prepare(1, 'other.js'), storage), /其他产物/)
  await assert.rejects(registerWebCandidate(source, await prepare(2, 'uploads/resources/file'), storage), /清单/)
  const second = await prepare(3)
  await registerWebCandidate(source, second, storage)
  assert.equal(writes.length, 0)
  const publish = (build: string, base: string | null) => promoteWebCandidate(source, build, base, 'admin-fixture', storage)
  const [a, b] = await Promise.allSettled([publish(first.build, null), publish(first.build, null)])
  assert.ok([a, b].some((result) => result.status === 'fulfilled'))
  assert.deepEqual(writes, ['asset.js', 'index.html', 'tbox-offline-sw.js', 'web-version.json'])
  await publish(first.build, null)
  assert.equal(writes.length, 4)
  await assert.rejects(publish(second.build, null), /变化/)
  fault = 'tbox-offline-sw.js'
  await assert.rejects(publish(second.build, first.build), /发布中断/)
  assert.equal(JSON.parse(objects.get('web-version.json')!.toString()).build, first.build)
  const listing = await listWebCandidates(source)
  assert.equal(listing.current?.build, first.build)
  assert.equal(listing.interrupted?.build, second.build)
  const third = await prepare(4)
  await registerWebCandidate(source, third, storage)
  await assert.rejects(publish(third.build, first.build), /先恢复/)
  fault = ''
  await publish(second.build, first.build)
  assert.equal((await listWebCandidates(source)).current?.build, second.build)
  await assert.rejects(publish(first.build, second.build), /高于/)
  console.info('Web approval: isolated candidates, idempotency, concurrency, stale baseline, publication order and interruption recovery passed')
} finally {
  if (source.isInitialized) {
    await source.destroy()
  }
  await admin.query('DROP DATABASE IF EXISTS ??', [database])
  await admin.end()
}
