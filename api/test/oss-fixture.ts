import type { DataSource } from 'typeorm'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { ossResourceBackend, OssResourceStorage } from '../src/resources/oss.js'
import { ResourceService } from '../src/resources/service.js'
import { ResourceStorageRegistry } from '../src/resources/storage.js'

/** Public object I/O is in memory; no cloud requests or download signatures are used. */
export function fixtureOss() {
  const options = { region: 'cn-hangzhou', bucket: 'tboxos', accessKeyId: 'fixture-access-id', accessKeySecret: 'fixture-secret-never-log' }
  const objects = new Map<string, Buffer>()
  const metadata = new Map<string, { mime: string, headers: Record<string, string> }>()
  let failWrites = false
  const client = {
    async put(path: string, bytes: Buffer, config: { mime: string, headers: Record<string, string> }) {
      assert.match(path, /^uploads\/resources\/[a-f0-9-]{36}$/)
      assert.equal(config.headers?.['x-oss-object-acl'], 'public-read')
      assert.equal(config.headers?.['x-oss-forbid-overwrite'], 'true')
      assert.equal(config.headers?.['Content-MD5'], createHash('md5').update(bytes).digest('base64'))
      if (failWrites || objects.has(path)) {
        throw new Error('fixture-secret-never-log')
      }
      objects.set(path, Buffer.from(bytes))
      metadata.set(path, config)
    },
    async get(path: string) {
      if (!objects.has(path)) {
        throw Object.assign(new Error('fixture-secret-never-log'), { code: 'NoSuchKey' })
      }
      return { content: objects.get(path)! }
    },
    async delete(path: string) {
      objects.delete(path)
      metadata.delete(path)
    },
  }
  const storage = new OssResourceStorage(options, client as unknown as OssResourceStorage['client'])
  const id = ossResourceBackend(options)
  const registry = new ResourceStorageRegistry(id, [{ id, storage }])
  return { storage, objects, metadata, registry, resources: (source: DataSource) => new ResourceService(source, undefined, registry), failWrites: (value: boolean) => {
    failWrites = value
  } }
}
