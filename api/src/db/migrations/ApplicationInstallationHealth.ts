import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ApplicationInstallationHealth1791244835000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`ALTER TABLE application_installations
      ADD error VARCHAR(300) NULL,
      ADD retry_attempts INT UNSIGNED NOT NULL DEFAULT 0,
      ADD retry_at DATETIME(3) NULL`)
  }

  async down() {
    throw new Error('Application installation health rollback requires a backup')
  }
}
