import type { MigrationInterface, QueryRunner } from 'typeorm'

export class Operations1791244838000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE operations_events (
      id CHAR(36) PRIMARY KEY, kind VARCHAR(24) NOT NULL, code VARCHAR(80) NOT NULL,
      request_id VARCHAR(100) NULL, task_id CHAR(36) NULL, stage VARCHAR(32) NULL,
      agent_id VARCHAR(100) NULL, http_status INT NULL, duration_ms INT NULL,
      provider_request_id VARCHAR(256) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY operations_recent(created_at,id),KEY operations_task(task_id,created_at)
    ) ENGINE=InnoDB`)
    await db.query('ALTER TABLE agent_tasks ADD KEY task_updated(updated_at,id)')
  }

  async down(): Promise<void> {
    throw new Error('Operations history requires an explicit retention/rollback decision')
  }
}
