import type { MigrationInterface, QueryRunner } from 'typeorm'

export class Notifications1791244846000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE notification_watermark (id TINYINT PRIMARY KEY, started_at DATETIME(3) NOT NULL) ENGINE=InnoDB`)
    await db.query('INSERT INTO notification_watermark VALUES(1,UTC_TIMESTAMP(3))')
    await db.query(`CREATE TABLE user_notifications (
      id CHAR(36) PRIMARY KEY,user_id CHAR(36) NOT NULL,source_key VARCHAR(100) NOT NULL,
      task_id CHAR(36) NOT NULL,kind VARCHAR(24) NOT NULL,read_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY notification_source(user_id,source_key),KEY notification_inbox(user_id,created_at,id),
      FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      FOREIGN KEY(task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('Notification history requires an explicit retention decision')
  }
}
