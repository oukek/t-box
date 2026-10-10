import type { MigrationInterface, QueryRunner } from "typeorm";
export class BillingPayments1791244808000 implements MigrationInterface {
  async up(db: QueryRunner) {
    for (const column of ["input_price", "output_price", "image_price"])
      if (!(await db.hasColumn("ai_models", column)))
        await db.query(
          `ALTER TABLE ai_models ADD ${column} DECIMAL(18,6) NOT NULL DEFAULT 0`,
        );
    await db.query(`CREATE TABLE IF NOT EXISTS billing_wallets (
      user_id CHAR(36) PRIMARY KEY, balance_micro BIGINT NOT NULL DEFAULT 0,
      reserved_micro BIGINT NOT NULL DEFAULT 0, mode ENUM('charge','record_only') NOT NULL DEFAULT 'charge',
      CONSTRAINT fk_wallet_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      CHECK(balance_micro>=0), CHECK(reserved_micro>=0), CHECK(balance_micro>=reserved_micro)
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS billing_usage (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, task_id CHAR(36) NULL,
      model_config_id CHAR(36) NOT NULL, prices_json JSON NOT NULL,
      kind ENUM('conversation','image') NOT NULL, mode ENUM('charge','record_only') NOT NULL,
      status ENUM('reserved','settled','review','released') NOT NULL DEFAULT 'reserved',
      reserved_micro BIGINT NOT NULL, fee_micro BIGINT NOT NULL DEFAULT 0, charged_micro BIGINT NOT NULL DEFAULT 0,
      input_tokens BIGINT NULL, output_tokens BIGINT NULL, images INT NULL, response_id VARCHAR(200) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      INDEX ix_usage_user(user_id,created_at), INDEX ix_usage_status(status,updated_at),
      CONSTRAINT fk_usage_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS billing_entries (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      kind ENUM('usage','recharge','grant') NOT NULL, reference_key VARCHAR(120) NOT NULL,
      amount_micro BIGINT NOT NULL, balance_micro BIGINT NOT NULL, reason VARCHAR(200) NOT NULL DEFAULT '',
      administrator_id CHAR(36) NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY ux_entry_reference(reference_key), INDEX ix_entry_user(user_id,created_at),
      CONSTRAINT fk_entry_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS billing_audit (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, administrator_id CHAR(36) NOT NULL,
      action VARCHAR(40) NOT NULL, detail VARCHAR(300) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      CONSTRAINT fk_billing_audit_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS payment_orders (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, request_key VARCHAR(80) NOT NULL,
      channel VARCHAR(20) NOT NULL DEFAULT 'wechat', amount_cents INT NOT NULL, currency CHAR(3) NOT NULL DEFAULT 'CNY',
      status ENUM('pending','paid','closed') NOT NULL DEFAULT 'pending', transaction_id VARCHAR(100) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), expires_at DATETIME(3) NOT NULL,
      paid_at DATETIME(3) NULL, UNIQUE KEY ux_order_request(user_id,request_key),
      UNIQUE KEY ux_gateway_transaction(channel,transaction_id), INDEX ix_orders_user(user_id,created_at),
      CONSTRAINT fk_order_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      CHECK(amount_cents>0)
    ) ENGINE=InnoDB`);
  }
  async down(): Promise<void> {
    throw new Error(
      "Billing data requires an explicit backup and reconciliation before rollback",
    );
  }
}
