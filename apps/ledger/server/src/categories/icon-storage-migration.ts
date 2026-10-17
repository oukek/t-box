import type { MigrationInterface, QueryRunner } from 'typeorm'

export class LedgerIconStorage1791244849000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE ledger_category_icons MODIFY content BLOB NULL,ADD object_path VARCHAR(512) NULL,ADD storage_backend VARCHAR(64) NULL')
  }

  async down(): Promise<void> {
    throw new Error('Uploaded category icons must be migrated before removing object locations')
  }
}
