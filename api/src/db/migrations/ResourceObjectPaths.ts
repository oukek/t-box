import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ResourceObjectPaths1791244848000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE resources ADD object_path VARCHAR(512) NULL')
    await db.query('UPDATE resources SET object_path=id WHERE object_path IS NULL')
    await db.query('ALTER TABLE resources MODIFY object_path VARCHAR(512) NOT NULL')
  }

  async down(): Promise<void> {
    throw new Error('Object paths cannot be discarded without migrating the stored files')
  }
}
