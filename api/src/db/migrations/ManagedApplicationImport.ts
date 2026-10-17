import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ManagedApplicationImport1791244850000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE application_import_credentials MODIFY expires_at DATETIME(3) NULL, ADD managed_key VARCHAR(32) NULL UNIQUE')
  }

  async down(): Promise<void> {
    throw new Error('Managed import credentials require a database backup to roll back')
  }
}
