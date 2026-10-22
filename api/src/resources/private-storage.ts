import { fileURLToPath } from 'node:url'
import { resourceStorageSettings } from '../config.js'
import { ErrorCode } from '../error-codes.js'
import { ossResourceBackend, OssResourceStorage } from './oss.js'
import { LocalResourceStorage, ResourceStorageRegistry } from './storage.js'

/** Private assets never inherit the public resource bucket or its CDN origin. */
export function runtimePrivateStorage() {
  const bucket = process.env.OSS_PRIVATE_RESOURCE_BUCKET?.trim()
  if (bucket) {
    const settings = resourceStorageSettings()
    if (
      !settings ||
      !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      bucket === settings.bucket
    ) {
      throw ErrorCode.PRIVATE_MEDIA_CONFIG_REQUIRED()
    }
    const options = { ...settings, bucket, private: true as const }
    const id = `private-${ossResourceBackend(options)}`
    return new ResourceStorageRegistry(id, [
      { id, storage: new OssResourceStorage(options) },
    ])
  }
  if (process.env.NODE_ENV === 'production') {
    return undefined
  }
  const storage = new LocalResourceStorage(
    fileURLToPath(new URL('../../.storage/private/', import.meta.url)),
  )
  return new ResourceStorageRegistry('private-local', [
    { id: 'private-local', storage },
  ])
}
