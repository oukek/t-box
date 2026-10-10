import type { MigrationInterface, QueryRunner } from "typeorm";
import { initializeAdminSchema } from "../../admin/schema.js";
export class InitialSchema1791158400000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`
    CREATE TABLE IF NOT EXISTS bills (
      id CHAR(36) NOT NULL PRIMARY KEY,
      type ENUM('income', 'expense') NOT NULL,
      amount DECIMAL(11, 2) NOT NULL,
      category VARCHAR(32) NOT NULL,
      bill_date DATE NOT NULL,
      note VARCHAR(200) NOT NULL DEFAULT '',
      created_at DATETIME(3) NOT NULL,
      updated_at DATETIME(3) NOT NULL,
      INDEX idx_bills_date_created (bill_date, created_at),
      INDEX idx_bills_type_date (type, bill_date),
      CONSTRAINT chk_bills_positive_amount CHECK (amount > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
    await initializeAdminSchema(runner);
  }
  async down(): Promise<void> {
    throw new Error(
      "Existing business data requires an explicit backup/restore; automatic table drops are disabled."
    );
  }
}
