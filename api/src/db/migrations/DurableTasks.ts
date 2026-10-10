import type { MigrationInterface, QueryRunner } from 'typeorm'

export class DurableTasks1791244804000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS agent_tasks (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, conversation_id CHAR(36) NOT NULL,
      request_id VARCHAR(100) NOT NULL, status VARCHAR(24) NOT NULL,
      active_key CHAR(36) NULL UNIQUE, agent_id VARCHAR(64) NOT NULL,
      checkpoint_json MEDIUMTEXT NOT NULL, lease_owner CHAR(36) NULL,
      lease_until DATETIME(3) NULL, cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
      reason VARCHAR(200) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY task_request (conversation_id, request_id),
      KEY task_user (user_id, updated_at), KEY task_recovery (status, lease_until)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await db.query(`CREATE TABLE IF NOT EXISTS agent_task_tools (
      task_id CHAR(36) NOT NULL, call_id VARCHAR(100) NOT NULL, name VARCHAR(64) NOT NULL,
      agent_id VARCHAR(64) NOT NULL, fingerprint CHAR(64) NOT NULL,
      effect VARCHAR(24) NOT NULL, status VARCHAR(24) NOT NULL, result_json MEDIUMTEXT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (task_id, call_id),
      CONSTRAINT task_tools_parent FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
  }

  async down(): Promise<void> {
    throw new Error('Durable tasks require an explicit backup before rollback')
  }
}
