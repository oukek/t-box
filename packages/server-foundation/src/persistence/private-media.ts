import type { EntityManager } from 'typeorm'
import { EntitySchema } from 'typeorm'

export interface PrivateMediaScope {
  type: string
  id: string
}
export interface PrivateMediaFile {
  id: string
  name: string
  mimeType: string
  size: number
  source: 'uploaded'
  createdAt: string
}
/** App-owned resource authorization. A platform file grant never replaces domain membership. */
export interface PrivateMediaPolicy {
  authorize(
    subject: string,
    scope: PrivateMediaScope,
    action: 'read' | 'write' | 'export',
    db: EntityManager,
  ): Promise<void>
}
export interface PrivateMediaPort {
  claim(
    db: EntityManager,
    subject: string,
    scope: PrivateMediaScope,
    ids: readonly string[],
  ): Promise<void>
  list(
    db: EntityManager,
    scope: PrivateMediaScope,
    ids: readonly string[],
  ): Promise<PrivateMediaFile[]>
}
export interface StoredPrivateFile {
  id: string
  appId: string
  scopeType: string
  scopeId: string
  uploadedBy: string
  name: string
  mimeType: string
  size: number
  storageBackend: string
  objectPath: string
  previewPath: string | null
  linkedAt: Date | null
  deletedAt: Date | null
  purgedAt: Date | null
  createdAt: Date
}
export const PrivateFileEntity = new EntitySchema<StoredPrivateFile>({
  name: 'PrivateApplicationFile',
  tableName: 'private_application_files',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    appId: { type: 'varchar', name: 'app_id', length: 64 },
    scopeType: { type: 'varchar', name: 'scope_type', length: 40 },
    scopeId: { type: 'varchar', name: 'scope_id', length: 80 },
    uploadedBy: { type: 'char', name: 'uploaded_by', length: 64 },
    name: { type: 'varchar', length: 200 },
    mimeType: { type: 'varchar', name: 'mime_type', length: 80 },
    size: { type: 'int', unsigned: true },
    storageBackend: { type: 'varchar', name: 'storage_backend', length: 64 },
    objectPath: { type: 'varchar', name: 'object_path', length: 512 },
    previewPath: {
      type: 'varchar',
      name: 'preview_path',
      length: 512,
      nullable: true,
    },
    linkedAt: {
      type: 'datetime',
      name: 'linked_at',
      precision: 3,
      nullable: true,
    },
    deletedAt: {
      type: 'datetime',
      name: 'deleted_at',
      precision: 3,
      nullable: true,
    },
    purgedAt: {
      type: 'datetime',
      name: 'purged_at',
      precision: 3,
      nullable: true,
    },
    createdAt: { type: 'datetime', name: 'created_at', precision: 3 },
  },
  indices: [
    { name: 'private_file_scope', columns: ['appId', 'scopeId', 'deletedAt'] },
    {
      name: 'private_file_cleanup',
      columns: ['linkedAt', 'createdAt', 'deletedAt'],
    },
  ],
})
export interface StoredPrivateFileQuota {
  appId: string
  scopeId: string
  bytes: string
  files: number
}
export const PrivateFileQuotaEntity = new EntitySchema<StoredPrivateFileQuota>({
  name: 'PrivateApplicationFileQuota',
  tableName: 'private_application_file_quotas',
  columns: {
    appId: { type: 'varchar', name: 'app_id', length: 64, primary: true },
    scopeId: { type: 'varchar', name: 'scope_id', length: 80, primary: true },
    bytes: { type: 'bigint', unsigned: true, default: '0' },
    files: { type: 'int', unsigned: true, default: 0 },
  },
})
