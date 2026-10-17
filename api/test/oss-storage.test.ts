import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { ossResourceBackend } from '../src/resources/oss.js'
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
