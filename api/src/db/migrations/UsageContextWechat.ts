import type { MigrationInterface, QueryRunner } from 'typeorm'

export class UsageContextWechat1791244809000 implements MigrationInterface {
  async up(db: QueryRunner) {
    const columns: Record<string, string> = {
      message_id: 'CHAR(36) NULL',
      agent_id: 'VARCHAR(100) NULL',
      purpose: 'VARCHAR(20) NOT NULL DEFAULT \'response\'',
      cached_tokens: 'BIGINT NULL',
      reasoning_tokens: 'BIGINT NULL',
      duration_ms: 'INT NULL',
    }
    for (const [name, type] of Object.entries(columns)) {
      if (!(await db.hasColumn('billing_usage', name))) {
        await db.query(`ALTER TABLE billing_usage ADD ${name} ${type}`)
      }
    }
    if (!(await db.hasColumn('ai_models', 'context_policy'))) {
      await db.query('ALTER TABLE ai_models ADD context_policy JSON NULL')
    }
    if (!(await db.hasColumn('payment_orders', 'configuration_id'))) {
      await db.query(
        'ALTER TABLE payment_orders ADD configuration_id CHAR(36) NULL, ADD payment_mode VARCHAR(10) NULL',
      )
    }
    await db.query(`CREATE TABLE IF NOT EXISTS payment_configurations (
      id CHAR(36) PRIMARY KEY, public_json JSON NOT NULL, secret_cipher MEDIUMTEXT NOT NULL,
      administrator_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
    ) ENGINE=InnoDB`)
    await db.query(
      `CREATE TABLE IF NOT EXISTS payment_settings (id INT PRIMARY KEY, configuration_id CHAR(36) NULL) ENGINE=InnoDB`,
    )
    await db.query('INSERT IGNORE INTO payment_settings(id) VALUES(1)')
    await db.query(`CREATE TABLE IF NOT EXISTS payment_oauth_states (
      state_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, order_id CHAR(36) NOT NULL,
      configuration_id CHAR(36) NOT NULL, consumed BOOLEAN NOT NULL DEFAULT FALSE,
      expires_at DATETIME(3) NOT NULL,
      CONSTRAINT fk_pay_oauth_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      CONSTRAINT fk_pay_oauth_order FOREIGN KEY(order_id) REFERENCES payment_orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
    await db.query(`CREATE TABLE IF NOT EXISTS payment_wechat_users (
      user_id CHAR(36) NOT NULL, app_id VARCHAR(32) NOT NULL, openid_cipher TEXT NOT NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), PRIMARY KEY(user_id,app_id),
      CONSTRAINT fk_wechat_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error(
      'Payment and usage records require a backed-up manual rollback',
    )
  }
}
