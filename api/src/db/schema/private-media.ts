import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const privateMediaSchema: DatabaseSchema = { id: 'private-media', tables: [
  `CREATE TABLE private_application_file_quotas (
      app_id varchar(64) NOT NULL,
      scope_id varchar(80) NOT NULL,
      bytes bigint unsigned NOT NULL DEFAULT '0',
      files int unsigned NOT NULL DEFAULT '0',
      PRIMARY KEY (app_id,scope_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE private_application_files (
      id char(36) NOT NULL,
      app_id varchar(64) NOT NULL,
      scope_type varchar(40) NOT NULL,
      scope_id varchar(80) NOT NULL,
      uploaded_by char(64) NOT NULL,
      name varchar(200) NOT NULL,
      mime_type varchar(80) NOT NULL,
      size int unsigned NOT NULL,
      storage_backend varchar(64) NOT NULL,
      object_path varchar(512) NOT NULL,
      preview_path varchar(512) DEFAULT NULL,
      linked_at datetime(3) DEFAULT NULL,
      deleted_at datetime(3) DEFAULT NULL,
      purged_at datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL,
      PRIMARY KEY (id),
      KEY private_file_scope(app_id,scope_id,deleted_at),
      KEY private_file_cleanup(linked_at,created_at,deleted_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
] }
