import type { MigrationInterface, QueryRunner } from 'typeorm'

export class PaymentRefunds1791244841000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`ALTER TABLE billing_entries MODIFY kind ENUM('usage','recharge','grant','refund') NOT NULL`)
    await db.query(`CREATE TABLE payment_refunds (
      id CHAR(36) PRIMARY KEY,order_id CHAR(36) NOT NULL,request_key VARCHAR(64) NOT NULL,
      administrator_id CHAR(36) NOT NULL,reason VARCHAR(80) NOT NULL,amount_cents INT NOT NULL,
      credit_micro BIGINT NOT NULL,status VARCHAR(24) NOT NULL DEFAULT 'prepared',refund_id VARCHAR(64) NULL,
      submitted BOOLEAN NOT NULL DEFAULT FALSE,error VARCHAR(200) NULL,
      lease_owner CHAR(36) NULL,lease_until DATETIME(3) NULL,next_query_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY refund_request(order_id,request_key),UNIQUE KEY refund_gateway(refund_id),KEY refund_pending(status,next_query_at),
      CONSTRAINT refund_order FOREIGN KEY(order_id) REFERENCES payment_orders(id) ON DELETE CASCADE,
      CHECK(amount_cents>0),CHECK(credit_micro>0)
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('Refunds require merchant and wallet reconciliation before rollback')
  }
}
