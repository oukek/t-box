import { EntitySchema } from 'typeorm'
import { utcSqlDateTime } from './columns.js'

/** Explicit runtime entity metadata. Owned here; initialization DDL stays immutable. */
export interface StoredResource {
  id: string
  user_id: string
  name: string
  mime_type: string
  size: number
  source: 'uploaded' | 'generated'
  deleted_at: string | null
  created_at: string
  storage_backend: string
  purged_at: string | null
  object_path: string
}

export const ResourceEntity = new EntitySchema<StoredResource>({
  name: 'Resource',
  tableName: 'resources',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    user_id: { type: 'char', name: 'user_id', length: 36 },
    name: { type: 'varchar', length: 200 },
    mime_type: { type: 'varchar', name: 'mime_type', length: 80 },
    size: { type: 'int', unsigned: true },
    source: { type: 'enum', enum: ['uploaded', 'generated'] },
    deleted_at: {
      type: 'datetime',
      name: 'deleted_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    created_at: {
      type: 'datetime',
      name: 'created_at',
      precision: 3,
      transformer: utcSqlDateTime,
    },
    storage_backend: { type: 'varchar', name: 'storage_backend', length: 64 },
    purged_at: {
      type: 'datetime',
      name: 'purged_at',
      nullable: true,
      precision: 3,
      transformer: utcSqlDateTime,
    },
    object_path: { type: 'varchar', name: 'object_path', length: 512 },
  },
  indices: [
    {
      name: 'idx_resource_user',
      columns: ['user_id', 'deleted_at', 'created_at'],
    },
    { name: 'resource_purge', columns: ['deleted_at', 'purged_at'] },
  ],
})
