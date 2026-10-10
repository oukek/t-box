import type { MigrationInterface, QueryRunner } from 'typeorm'

export class RechargeConfiguration1791244814000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS recharge_settings (
      id TINYINT PRIMARY KEY, configuration JSON NOT NULL, revision INT NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NULL, updated_by CHAR(36) NULL, CHECK(id=1)
    ) ENGINE=InnoDB`)
    await db.query(
      'INSERT IGNORE INTO recharge_settings(id,configuration) VALUES(1,?)',
      [
        JSON.stringify({
          presets: ['10', '30', '50', '100', '200', '500'],
          bonusRules: [],
          minAmount: '1',
          maxAmount: '10000',
        }),
      ],
    )
    if (!(await db.hasColumn('payment_orders', 'bonus_cents'))) {
      await db.query(
        'ALTER TABLE payment_orders ADD bonus_cents INT NOT NULL DEFAULT 0, ADD CONSTRAINT nonnegative_payment_bonus CHECK(bonus_cents>=0)',
      )
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'Recharge bonus snapshots require reconciliation before rollback',
    )
  }
}
