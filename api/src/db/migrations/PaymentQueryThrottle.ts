import type { MigrationInterface, QueryRunner } from "typeorm";
export class PaymentQueryThrottle1791244810000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn("payment_orders", "next_query_at")))
      await db.query(
        "ALTER TABLE payment_orders ADD next_query_at DATETIME(3) NULL",
      );
  }
  async down(): Promise<void> {
    throw new Error("Manual payment migration rollback required");
  }
}
