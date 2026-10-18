import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const resourcesSchema: DatabaseSchema = {
  id: 'resources',
  tables: [
    `CREATE TABLE resources (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      name varchar(200) NOT NULL,
      mime_type varchar(80) NOT NULL,
      size int unsigned NOT NULL,
      source enum('uploaded','generated') NOT NULL,
      deleted_at datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      storage_backend varchar(64) NOT NULL DEFAULT 'local',
      purged_at datetime(3) DEFAULT NULL,
      object_path varchar(512) NOT NULL,
      PRIMARY KEY (id),
      KEY idx_resource_user (user_id,deleted_at,created_at),
      KEY resource_purge (deleted_at,purged_at),
      CONSTRAINT resources_ibfk_1 FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
