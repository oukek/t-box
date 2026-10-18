import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const timeSchema: DatabaseSchema = {
  id: 'time',
  tables: [
    `CREATE TABLE app_timers (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      data json NOT NULL,
      revision int NOT NULL DEFAULT '1',
      deleted tinyint(1) NOT NULL DEFAULT '0',
      created_at datetime(3) NOT NULL,
      PRIMARY KEY (id),
      KEY timer_owner (user_id,deleted),
      CONSTRAINT timer_owner_fk FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
