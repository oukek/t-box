import type { MigrationInterface, QueryRunner } from 'typeorm'

export class TaskRecovery1791244837000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`ALTER TABLE agent_tasks
      ADD COLUMN recovery_auth_hash CHAR(64) NULL,
      ADD COLUMN recovery_ready BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN recovery_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      ADD COLUMN recovery_after DATETIME(3) NULL,
      ADD COLUMN recovery_claim CHAR(36) NULL,
      ADD COLUMN recovery_claim_until DATETIME(3) NULL,
      ADD KEY task_background (recovery_ready,recovery_after)`)
    // Old tasks deliberately remain manual: no identity is inferred retrospectively.
  }

  async down(): Promise<void> {
    throw new Error('Task recovery rollback requires an explicit backup and operator review')
  }
}
