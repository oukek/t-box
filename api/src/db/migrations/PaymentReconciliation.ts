import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PaymentReconciliation1791244843000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE payment_refunds ADD succeeded_at DATETIME(3) NULL,ADD KEY refund_success(succeeded_at)')
    await db.query(`CREATE TABLE payment_reconciliations (
      id CHAR(36) PRIMARY KEY,day DATE NOT NULL,merchant_hash CHAR(64) NOT NULL,configuration_id CHAR(36) NOT NULL,
      status VARCHAR(24) NOT NULL DEFAULT 'pending',row_count INT NOT NULL DEFAULT 0,difference_count INT NOT NULL DEFAULT 0,
      details_json JSON NULL,statement_sha1 CHAR(40) NULL,error VARCHAR(200) NULL,attempts INT NOT NULL DEFAULT 0,
      lease_owner CHAR(36) NULL,lease_until DATETIME(3) NULL,next_attempt_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY merchant_day(merchant_hash,day),KEY reconciliation_pending(status,next_attempt_at)
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('Merchant reconciliations require explicit financial record retention')
  }
}
