import type { MigrationInterface, QueryRunner } from "typeorm";
/** Backend seed data, never a runtime whitelist shared with the client. */
const defaults = [
  ["food", "expense", "餐饮", "food"],
  ["transport", "expense", "交通", "transport"],
  ["shopping", "expense", "购物", "shopping"],
  ["housing", "expense", "居家", "housing"],
  ["entertainment", "expense", "娱乐", "entertainment"],
  ["health", "expense", "医疗", "health"],
  ["expense_other", "expense", "其他支出", "other"],
  ["salary", "income", "工资", "salary"],
  ["bonus", "income", "奖金", "bonus"],
  ["income_other", "income", "其他收入", "other"],
];
export class Categories1791158401000 implements MigrationInterface {
  async up(runner: QueryRunner) {
    await runner.query(`CREATE TABLE IF NOT EXISTS bill_categories (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      type ENUM('income','expense') NOT NULL,
      label VARCHAR(40) NOT NULL, icon VARCHAR(32) NOT NULL DEFAULT 'other',
      is_default BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE KEY uq_category_type_label(type,label), UNIQUE KEY uq_category_id_type(id,type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    for (const row of defaults)
      await runner.query(
        "INSERT IGNORE INTO bill_categories (id,type,label,icon,is_default) VALUES (?,?,?,?,TRUE)",
        row
      );
    await runner.query(
      "ALTER TABLE bills MODIFY category VARCHAR(36) NOT NULL"
    );
    await runner.query(
      "UPDATE bills SET category=IF(type='income','income_other','expense_other') WHERE category='other'"
    );
    // Preserve any pre-existing custom identifiers rather than discarding their bills.
    await runner.query(`INSERT IGNORE INTO bill_categories (id,type,label,icon,is_default)
      SELECT DISTINCT b.category,b.type,b.category,'other',FALSE FROM bills b
      LEFT JOIN bill_categories c ON c.id=b.category AND c.type=b.type WHERE c.id IS NULL`);
    const existing = await runner.query(
      "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND CONSTRAINT_NAME='fk_bill_category_type'"
    );
    if (!existing.length)
      await runner.query(
        "ALTER TABLE bills ADD CONSTRAINT fk_bill_category_type FOREIGN KEY(category,type) REFERENCES bill_categories(id,type) ON DELETE RESTRICT"
      );
  }
  async down(): Promise<void> {
    throw new Error(
      "Category migration preserves existing bills; restore a backup explicitly instead of dropping data."
    );
  }
}
