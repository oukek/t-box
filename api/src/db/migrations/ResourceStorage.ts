import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ResourceStorage1791244845000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE resources ADD storage_backend VARCHAR(64) NOT NULL DEFAULT \'local\',ADD purged_at DATETIME(3) NULL,ADD KEY resource_purge(deleted_at,purged_at)')
  }

  async down(): Promise<void> {
    throw new Error('Resource locations cannot be discarded without migrating private objects')
  }
}
