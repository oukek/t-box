import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PaymentConfigurationVersion1791244812000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn('payment_configurations', 'version'))) {
      await db.query(
        'ALTER TABLE payment_configurations ADD version BIGINT UNSIGNED NOT NULL AUTO_INCREMENT UNIQUE',
      )
    }
  }

  async down(): Promise<void> {
    throw new Error('Configuration audit versions require explicit rollback')
  }
}
