import { resourceStorageSettings } from '../config.js'
import { ossResourceBackend, OssResourceStorage } from './oss.js'
import { LocalResourceStorage, ResourceStorageRegistry } from './storage.js'

export function runtimeResourceStorage(root: string) {
  const options = resourceStorageSettings()
  const local = { id: 'local', storage: new LocalResourceStorage(root) }
  if (!options) {
    return new ResourceStorageRegistry('local', [local])
  }
  const id = ossResourceBackend(options)
  const remote = { id, storage: new OssResourceStorage(options) }
  return new ResourceStorageRegistry(id, process.env.NODE_ENV === 'production' ? [remote] : [local, remote])
}
