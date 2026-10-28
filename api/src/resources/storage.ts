import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseId } from '@t-box/server-foundation/validation'
import { ErrorCode } from '../error-codes.js'

export interface ResourceFileMetadata {
  name: string
  mimeType: string
}
/** Object keys are persisted independently of the public origin; deletion must be idempotent. */
export interface ResourceStorage {
  readonly origin?: string
  /** Allocate once and persist the returned key; remote storage names are independently random. */
  path?(id: string): string
  write(id: string, bytes: Buffer, file?: ResourceFileMetadata): Promise<void>
  read(id: string): Promise<Buffer>
  remove(id: string): Promise<void>
}
export class LocalResourceStorage implements ResourceStorage {
  constructor(readonly root: string) {}
  async write(id: string, bytes: Buffer) {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    await writeFile(join(this.root, parseId(id)), bytes, {
      flag: 'wx',
      mode: 0o600,
    })
  }

  read(id: string) {
    return readFile(join(this.root, parseId(id)))
  }

  async remove(id: string) {
    await unlink(join(this.root, parseId(id))).catch((error) => {
      if (error.code !== 'ENOENT') {
        throw error
      }
    })
  }
}
/** Persist backend IDs per resource; changing the active backend never strands older objects. */
export class ResourceStorageRegistry {
  private readonly backends = new Map<string, ResourceStorage>()
  constructor(
    readonly activeId: string,
    entries: readonly { id: string, storage: ResourceStorage }[],
  ) {
    for (const entry of entries) {
      if (
        !/^[a-z][\w.-]{0,63}$/.test(entry.id) ||
        this.backends.has(entry.id)
      ) {
        throw ErrorCode.INTERNAL_RESOURCE_STORAGE_IDS_MUST_BE_UNIQUE_AND_IMMUTABLE()
      }
      this.backends.set(entry.id, entry.storage)
    }
    this.get(activeId)
  }

  get(id: string) {
    const storage = this.backends.get(id)
    if (!storage) {
      throw ErrorCode.RESOURCE_STORAGE_UNAVAILABLE(
        '文件存储暂时不可用，请联系管理员核对原存储配置',
      )
    }
    return storage
  }
}
