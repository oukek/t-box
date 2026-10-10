import { randomUUID } from "node:crypto";
import type { MigrationInterface, QueryRunner } from "typeorm";
import { CATEGORY_SEEDS } from "./defaults.js";

export class LedgerCategoryPresets1791244832000 implements MigrationInterface {
  name = "LedgerCategoryPresets1791244832000";
  async up(q: QueryRunner) {
    await q.query(
      "CREATE TABLE ledger_category_catalog(id TINYINT PRIMARY KEY,revision INT NOT NULL DEFAULT 1) ENGINE=InnoDB",
    );
    await q.query("INSERT INTO ledger_category_catalog(id) VALUES(1)");
    await q.query(`CREATE TABLE ledger_category_presets(
      id CHAR(36) PRIMARY KEY,type ENUM('income','expense') NOT NULL,label VARCHAR(40) NOT NULL,
      icon VARCHAR(32) NOT NULL,active BOOLEAN NOT NULL DEFAULT TRUE,sort_order INT NOT NULL DEFAULT 0,
      revision INT NOT NULL DEFAULT 1,updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY uq_preset_label(type,label)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await q.query(`CREATE TABLE ledger_category_preset_audit(
      id CHAR(36) PRIMARY KEY,preset_id CHAR(36) NOT NULL,administrator_id CHAR(36) NOT NULL,
      before_json JSON NULL,after_json JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      INDEX idx_preset_audit(preset_id,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await q.query(`ALTER TABLE bill_categories ADD preset_id CHAR(36) NULL,
      ADD UNIQUE KEY uq_book_preset(ledger_id,preset_id),
      ADD CONSTRAINT fk_category_preset FOREIGN KEY(preset_id) REFERENCES ledger_category_presets(id),
      DROP INDEX uq_book_category_label,
      ADD UNIQUE KEY uq_book_category_label(ledger_id,type,label,is_default)`);
    await q.startTransaction();
    try {
      for (const [order, seed] of CATEGORY_SEEDS.entries()) {
        const id = randomUUID();
        await q.query(
          "INSERT INTO ledger_category_presets(id,type,label,icon,sort_order) VALUES(?,?,?,?,?)",
          [id, seed.type, seed.label, seed.icon, order],
        );
        // Keep local category IDs so bills, budgets and statistical projections remain valid.
        await q.query(
          "UPDATE bill_categories SET preset_id=? WHERE is_default=TRUE AND type=? AND label=?",
          [id, seed.type, seed.label],
        );
      }
      // Previously renamed defaults become custom; never overwrite their historical meaning.
      await q.query(
        "UPDATE bill_categories SET is_default=FALSE WHERE is_default=TRUE AND preset_id IS NULL",
      );
      await q.query(`UPDATE bill_categories c JOIN ledger_category_presets p ON p.id=c.preset_id
        SET c.icon=p.icon,c.active=p.active,c.sort_order=p.sort_order,c.pinned=FALSE`);
      await q.query(`INSERT INTO bill_categories(id,ledger_id,type,label,icon,is_default,sort_order,active,preset_id)
        SELECT UUID(),l.id,p.type,p.label,p.icon,TRUE,p.sort_order,p.active,p.id
        FROM ledgers l CROSS JOIN ledger_category_presets p
        WHERE NOT EXISTS(SELECT 1 FROM bill_categories c WHERE c.ledger_id=l.id AND c.preset_id=p.id)`);
      await q.commitTransaction();
    } catch (e) {
      await q.rollbackTransaction();
      throw e;
    }
  }
  async down() {
    throw new Error(
      "系统分类迁移保留账单关联，不支持自动回滚，请恢复完整备份。",
    );
  }
}
