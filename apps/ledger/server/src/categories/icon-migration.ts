import type { MigrationInterface, QueryRunner } from "typeorm";
export class LedgerCategoryIcons1791244833000 implements MigrationInterface {
  name = "LedgerCategoryIcons1791244833000";
  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE ledger_category_icons(
      id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,created_by CHAR(36) NOT NULL,
      content BLOB NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      INDEX idx_category_icon_book(ledger_id),FOREIGN KEY(ledger_id) REFERENCES ledgers(id)
    ) ENGINE=InnoDB`);
    await q.query(
      "ALTER TABLE bill_categories ADD icon_id CHAR(36) NULL, ADD CONSTRAINT fk_category_icon FOREIGN KEY(icon_id) REFERENCES ledger_category_icons(id)",
    );
  }
  async down() {
    throw new Error("分类图标包含用户上传图片，请恢复完整备份。");
  }
}
