import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataSource } from '../src/db/data-source.js'
import { PlatformService } from '../src/platform/service.js'
import { migrateLocalResources } from '../src/resources/migrate-local.js'
import { ResourceService } from '../src/resources/service.js'
import { LocalResourceStorage, ResourceStorageRegistry } from '../src/resources/storage.js'
import { cleanupUsers } from './fixtures.js'
import { fixtureOss } from './oss-fixture.js'

const source = await createDataSource().initialize()
const root = await mkdtemp(join(tmpdir(), 'tbox-local-migration-'))
const local = new LocalResourceStorage(root)
const old = new ResourceService(source, root, new ResourceStorageRegistry('local', [{ id: 'local', storage: local }]))
const platform = new PlatformService(source, undefined, undefined, undefined, undefined, old)
const oss = fixtureOss()
let user = ''
let icon = ''
try {
  const login = await platform.identity.register({ username: `migration_${randomUUID().replaceAll('-', '')}`, password: 'test123' }, 'migration-fixture')
  user = login.user.id
  const actor = await platform.identity.authenticate(login.token)
  const file = await old.create(actor, 'old.txt', Buffer.from('owned local bytes'))
  const deleted = await old.create(actor, 'deleted.txt', Buffer.from('deleted local bytes'))
  await old.remove(actor, deleted.id)
  const [book] = await source.query('SELECT id FROM ledgers WHERE owner_id=?', [user])
  icon = randomUUID()
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64')
  await source.query('INSERT INTO ledger_category_icons(id,ledger_id,created_by,content) VALUES(?,?,?,?)', [icon, book.id, user, png])
  await writeFile(join(root, 'unrelated.txt'), 'unrelated file')
  oss.failWrites(true)
  await assert.rejects(migrateLocalResources(source, local, oss.storage, oss.registry.activeId))
  assert.equal((await local.read(file.id)).toString(), 'owned local bytes')
  assert.equal((await source.query('SELECT storage_backend FROM resources WHERE id=?', [file.id]))[0].storage_backend, 'local')
  oss.failWrites(false)
  assert.equal((await migrateLocalResources(source, local, oss.storage, oss.registry.activeId)).migrated, 2)
  const next = oss.resources(source)
  assert.equal((await next.bytes(actor, file.id)).bytes.toString(), 'owned local bytes')
  await assert.rejects(local.read(file.id), { code: 'ENOENT' })
  const [image] = await source.query('SELECT object_path,storage_backend,content FROM ledger_category_icons WHERE id=?', [icon])
  assert.equal(image.content, null)
  assert.equal(image.storage_backend, oss.registry.activeId)
  assert.deepEqual(oss.objects.get(image.object_path), png)
  // A crash after committing the OSS location leaves a safe cleanup task for the next run.
  await writeFile(join(root, file.id), 'owned local bytes')
  assert.equal((await migrateLocalResources(source, local, oss.storage, oss.registry.activeId)).migrated, 0)
  await assert.rejects(local.read(file.id), { code: 'ENOENT' })
  assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'unrelated file')
  console.log('OSS migration passed: failure preserves originals, exact-byte verification, committed locations, legacy icon conversion, resumed unlink and unrelated-file preservation')
} finally {
  if (icon) {
    await source.query('DELETE FROM ledger_category_icons WHERE id=?', [icon])
  }
  await cleanupUsers(source, user ? [user] : [])
  await rm(root, { recursive: true, force: true })
  await source.destroy()
}
