import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDataSource } from '../src/db/data-source.js'
import { IdentityService } from '../src/identity/service.js'
import { ResourceService } from '../src/resources/service.js'
import { LocalResourceStorage, ResourceStorageRegistry } from '../src/resources/storage.js'
import { cleanupUsers } from './fixtures.js'

const source = await createDataSource().initialize()
const root = await mkdtemp(join(tmpdir(), 'tbox-resource-storage-'))
const users: string[] = []
const objects = new Map<string, Buffer>()
let failDeletion = true
const objectStorage = { async write(id: string, bytes: Buffer) {
  objects.set(id, bytes)
}, async read(id: string) {
  const bytes = objects.get(id)
  assert.ok(bytes)
  return bytes
}, async remove(id: string) {
  if (failDeletion) {
    throw new Error('fixture storage temporarily unavailable')
  }
  objects.delete(id)
} }
try {
  const identity = new IdentityService(source, undefined, 'internal')
  const login = await identity.register({ username: `storage_${randomUUID().replaceAll('-', '')}`, password: 'test123', nickname: '存储测试' }, 'storage-fixture')
  users.push(login.user.id)
  const actor = await identity.authenticate(login.token)
  const local = { id: 'local', storage: new LocalResourceStorage(root) }
  const remote = { id: 'private-bucket-v1', storage: objectStorage }
  const original = new ResourceService(source, root, new ResourceStorageRegistry('private-bucket-v1', [local, remote]))
  const file = await original.create(actor, 'first.txt', Buffer.from('first backend fixture'))
  assert.equal('storage_backend' in file, false)
  const changed = new ResourceService(source, root, new ResourceStorageRegistry('local', [local, remote]))
  const second = await changed.create(actor, 'second.txt', Buffer.from('local backend fixture'))
  assert.equal((await changed.bytes(actor, file.id)).bytes.toString(), 'first backend fixture')
  assert.equal((await changed.bytes(actor, second.id)).bytes.toString(), 'local backend fixture')
  const quota = await changed.quota(actor)
  assert.equal(quota.files, 2)
  assert.equal(quota.bytes, file.size + second.size)
  const missing = new ResourceService(source, root, new ResourceStorageRegistry('local', [local]))
  await assert.rejects(missing.bytes(actor, file.id), { code: 'RESOURCE_STORAGE_UNAVAILABLE' })
  await changed.remove(actor, file.id)
  assert.equal(objects.has(file.id), true)
  await assert.rejects(changed.get(actor, file.id), { code: 'RESOURCE_NOT_FOUND' })
  failDeletion = false
  await changed.purgeDeleted()
  assert.equal(objects.has(file.id), false)
  const [purged] = await source.query('SELECT purged_at FROM resources WHERE id=?', [file.id])
  assert.ok(purged.purged_at)
  assert.equal((await changed.bytes(actor, second.id)).bytes.toString(), 'local backend fixture', 'Cleanup never touches live resources')
  await changed.remove(actor, second.id)
  assert.equal((await changed.quota(actor)).files, 0)
  console.log('Resource storage integration passed: persisted backend routing, private metadata, capacity, deletion retries and live-object preservation')
} finally {
  await cleanupUsers(source, users)
  await rm(root, { recursive: true, force: true })
  await source.destroy()
}
