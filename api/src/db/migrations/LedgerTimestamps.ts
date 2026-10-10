import type { MigrationInterface, QueryRunner } from "typeorm";
/** DATETIME has no timezone: persist UTC explicitly, regardless of MySQL's server timezone. */
export class LedgerTimestamps1791244801000 implements MigrationInterface {
  async up(db: QueryRunner) {
    for (const [table, column] of [
      ["app_users", "created_at"],
      ["ledgers", "created_at"],
      ["ledger_members", "joined_at"],
      ["ledger_operations", "created_at"],
      ["ledger_audit", "created_at"],
      ["debt_positions", "created_at"],
      ["debt_settlements", "created_at"],
      ["ledger_events", "created_at"],
    ]) {
      const [definition] = await db.query(
        "SELECT COLUMN_DEFAULT AS value FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
        [table, column],
      );
      if (String(definition.value).toLowerCase().includes("utc_timestamp"))
        continue;
      await db.query(
        `UPDATE ${table} SET ${column}=TIMESTAMPADD(SECOND,-TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),NOW()),${column})`,
      );
      await db.query(
        `ALTER TABLE ${table} ALTER COLUMN ${column} SET DEFAULT (UTC_TIMESTAMP(3))`,
      );
    }
  }
  async down(): Promise<void> {
    throw new Error(
      "Keep UTC timestamps; rollback requires an explicit data conversion.",
    );
  }
}
