import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CacheWriteUsage1791244811000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn('billing_usage', 'cache_write_tokens'))) {
      await db.query(
        'ALTER TABLE billing_usage ADD cache_write_tokens BIGINT NULL',
      )
    }
  }

  async down(): Promise<void> {
    throw new Error('Usage audit rollback requires explicit migration')
  }
}
