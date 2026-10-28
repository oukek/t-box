import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ossResourceBackend, OssResourceStorage } from '../src/resources/oss.js'
import { runtimePrivateStorage } from '../src/resources/private-storage.js'
import { fixtureOss } from './oss-fixture.js'

test('public OSS objects preserve bytes, image preview headers and safe file downloads without signatures', async () => {
  const { storage, objects, metadata } = fixtureOss()
  const path = storage.path(randomUUID())
  const bytes = Buffer.from('public upload')
  await storage.write(path, bytes, { name: '账单.html', mimeType: 'text/html' })
  assert.deepEqual(await storage.read(path), bytes)
  assert.equal(storage.origin, 'https://tboxos.oss-cn-hangzhou.aliyuncs.com')
  assert.equal(metadata.get(path)?.headers['x-oss-object-acl'], 'public-read')
  assert.equal(metadata.get(path)?.mime, 'application/octet-stream')
  assert.match(metadata.get(path)!.headers['Content-Disposition']!, /^attachment;/)
  assert.equal(metadata.get(path)?.headers['Cache-Control'], 'no-store')
  assert.equal('access' in storage, false)
  const imagePath = storage.path(randomUUID())
  await storage.write(imagePath, bytes, { name: '凭证.png', mimeType: 'image/png' })
  assert.equal(metadata.get(imagePath)?.mime, 'image/png')
  assert.match(metadata.get(imagePath)!.headers['Content-Disposition']!, /^inline;/)
  await storage.remove(imagePath)
  await storage.remove(path)
  await storage.remove(path)
  assert.equal(objects.size, 0)
  await assert.rejects(storage.read(path), { statusCode: 404 })
})

test('OSS failures are sanitized, uploads cannot overwrite objects or escape the upload prefix', async () => {
  const { storage, failWrites, objects } = fixtureOss()
  const path = storage.path(randomUUID())
  await storage.write(path, Buffer.from('first'))
  await assert.rejects(storage.write(path, Buffer.from('second')), { code: 'RESOURCE_STORAGE_UNAVAILABLE' })
  assert.equal(objects.get(path)?.toString(), 'first')
  failWrites(true)
  await assert.rejects(storage.write(storage.path(randomUUID()), Buffer.from('new')), (error: any) => error.code === 'RESOURCE_STORAGE_UNAVAILABLE' && !error.message.includes('fixture-secret'))
  await assert.rejects(storage.remove(`index.html/${randomUUID()}`))
  assert.equal(objects.size, 1)
})

test('physical bucket identity survives credential rotation and differs across buckets or regions', () => {
  const first = ossResourceBackend({ region: 'cn-hangzhou', bucket: 'tboxos' })
  assert.equal(first, ossResourceBackend({ region: 'cn-hangzhou', bucket: 'tboxos' }))
  assert.notEqual(first, ossResourceBackend({ region: 'cn-hangzhou', bucket: 'other-bucket' }))
  assert.notEqual(first, ossResourceBackend({ region: 'cn-shanghai', bucket: 'tboxos' }))
})

test('shared-bucket app files use random keys and retain private object ACLs without public URLs', async () => {
  const writes: { path: string, acl: string }[] = []
  const client = { async put(path: string, _bytes: Buffer, options: { headers: Record<string, string> }) {
    writes.push({ path, acl: options.headers['x-oss-object-acl']! })
  } }
  const storage = new OssResourceStorage({ region: 'cn-hangzhou', bucket: 'tboxos', accessKeyId: 'fixture', accessKeySecret: 'fixture', private: true }, client as unknown as OssResourceStorage['client'])
  const path = storage.path(randomUUID())
  await storage.write(path, Buffer.from('private photo'), { name: '宝宝.png', mimeType: 'image/png' })
  assert.equal(storage.origin, undefined)
  assert.equal(writes[0]?.acl, 'private')
  assert.match(writes[0]!.path, /^uploads\/resources\/application-files\/[a-f0-9]{64}$/)
  await assert.rejects(storage.write(`uploads/resources/${randomUUID()}`, Buffer.from('no public path')))
})

test('object names are independent from resource IDs and previously stored UUID paths remain readable', async () => {
  const { storage, objects } = fixtureOss()
  const id = randomUUID()
  const paths = Array.from({ length: 32 }, () => storage.path(id))
  assert.equal(new Set(paths).size, paths.length)
  for (const path of paths) {
    assert.match(path, /^uploads\/resources\/[a-f0-9]{64}$/)
    assert.ok(!path.includes(id))
  }
  const legacy = `uploads/resources/${id}`
  objects.set(legacy, Buffer.from('legacy bytes'))
  assert.equal((await storage.read(legacy)).toString(), 'legacy bytes')
  await storage.remove(legacy)
  assert.equal(objects.has(legacy), false)
  for (const path of ['uploads/resources/../index.html', `uploads/resources/${'a'.repeat(64)}/other`, `uploads/resources/application-files/${'b'.repeat(64)}`]) {
    await assert.rejects(storage.read(path))
  }
})

test('production app attachment storage uses the shared bucket with no additional bucket configuration', (t) => {
  const previous = { ...process.env }
  t.after(() => {
    for (const name of Object.keys(process.env)) {
      if (!(name in previous)) {
        delete process.env[name]
      }
    }
    Object.assign(process.env, previous)
  })
  Object.assign(process.env, { NODE_ENV: 'production', APP_ARTIFACT_DELIVERY: 'oss', OSS_REGION: 'cn-hangzhou', OSS_RESOURCE_BUCKET: 'tboxos', OSS_ACCESS_KEY_ID: 'fixture', OSS_ACCESS_KEY_SECRET: 'fixture' })
  const registry = runtimePrivateStorage()
  const storage = registry.get(registry.activeId) as OssResourceStorage
  assert.equal(storage.origin, undefined)
  assert.match(storage.path(randomUUID()), /^uploads\/resources\/application-files\/[a-f0-9]{64}$/)
  assert.equal(registry.activeId, 'private-' + ossResourceBackend({ region: 'cn-hangzhou', bucket: 'tboxos' }))
})
