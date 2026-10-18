import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const operationsSchema: DatabaseSchema = {
  id: 'operations',
  async seed(db) {
    await db.query('INSERT INTO notification_watermark(id,started_at) VALUES(1,UTC_TIMESTAMP(3))')
  },
  tables: [
    `CREATE TABLE notification_watermark (
      id tinyint NOT NULL,
      started_at datetime(3) NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE operations_events (
      id char(36) NOT NULL,
      kind varchar(24) NOT NULL,
      code varchar(80) NOT NULL,
      request_id varchar(100) DEFAULT NULL,
      task_id char(36) DEFAULT NULL,
      stage varchar(32) DEFAULT NULL,
      agent_id varchar(100) DEFAULT NULL,
      http_status int DEFAULT NULL,
      duration_ms int DEFAULT NULL,
      provider_request_id varchar(256) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (id),
      KEY operations_recent (created_at,id),
      KEY operations_task (task_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE user_notifications (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      source_key varchar(100) NOT NULL,
      task_id char(36) NOT NULL,
      kind varchar(24) NOT NULL,
      read_at datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (id),
      UNIQUE KEY notification_source (user_id,source_key),
      KEY notification_inbox (user_id,created_at,id),
      KEY task_id (task_id),
      CONSTRAINT user_notifications_ibfk_1 FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE,
      CONSTRAINT user_notifications_ibfk_2 FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
