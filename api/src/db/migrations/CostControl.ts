import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CostControl1791244839000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE billing_usage ADD cost_reserved_micro BIGINT NOT NULL DEFAULT 0, ADD KEY usage_task_cost(task_id),ADD KEY usage_daily_cost(created_at)')
    await db.query('UPDATE billing_usage SET cost_reserved_micro=GREATEST(reserved_micro,fee_micro)')
    await db.query('CREATE TABLE ai_cost_guard (id INT PRIMARY KEY) ENGINE=InnoDB')
    await db.query('INSERT INTO ai_cost_guard(id) VALUES(1)')
    await db.query('CREATE TABLE ai_provider_pools (provider_id CHAR(36) PRIMARY KEY) ENGINE=InnoDB')
    await db.query(`CREATE TABLE ai_provider_leases (
      id CHAR(36) PRIMARY KEY,provider_id CHAR(36) NOT NULL,expires_at DATETIME(3) NOT NULL,
      KEY provider_active(provider_id,expires_at)
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('Cost control rollback requires an explicit budget reconciliation')
  }
}
