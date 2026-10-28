import { fileURLToPath } from 'node:url'
import { resourceStorageSettings } from '../config.js'
import { ossResourceBackend, OssResourceStorage } from './oss.js'
import { LocalResourceStorage, ResourceStorageRegistry } from './storage.js'

/** Share the business bucket and credentials; private object ACLs still require server-authorized reads. */
export function runtimePrivateStorage() {
  const settings = resourceStorageSettings()
  if (settings) {
    const options = { ...settings, private: true as const }
    const id = `private-${ossResourceBackend(options)}`
    return new ResourceStorageRegistry(id, [
      { id, storage: new OssResourceStorage(options) },
    ])
  }
  const storage = new LocalResourceStorage(
    fileURLToPath(new URL('../../.storage/private/', import.meta.url)),
  )
  return new ResourceStorageRegistry('private-local', [
    { id: 'private-local', storage },
  ])
}
