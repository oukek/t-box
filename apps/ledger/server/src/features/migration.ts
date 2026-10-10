import type { MigrationInterface, QueryRunner } from "typeorm";
export class LedgerFeatures1791244829000 implements MigrationInterface {
  name = "LedgerFeatures1791244829000";
  async up(q: QueryRunner) {
    await q.query(
      "ALTER TABLE bill_categories ADD active BOOLEAN NOT NULL DEFAULT TRUE, ADD pinned BOOLEAN NOT NULL DEFAULT FALSE",
    );
    await q.query("ALTER TABLE bills ADD account_id CHAR(36) NULL");
    await q.query(
      "ALTER TABLE debt_positions ADD account_id CHAR(36) NULL, ADD contact_id CHAR(36) NULL, ADD adjusted DECIMAL(11,2) NOT NULL DEFAULT 0",
    );
    await q.query("ALTER TABLE debt_settlements ADD account_id CHAR(36) NULL");
    await q.query(
      "ALTER TABLE ledger_events MODIFY kind ENUM('income','expense','lend','borrow','collect','repay','correction','refund','transfer','writeoff','reimbursement') NOT NULL",
    );
    const tables: Record<string, string> = {
      ledger_accounts:
        "name VARCHAR(60) NOT NULL,kind VARCHAR(12) NOT NULL,archived BOOLEAN NOT NULL DEFAULT FALSE",
      ledger_account_entries:
        "account_id CHAR(36) NOT NULL,subject_id CHAR(36) NOT NULL,entry_date DATE NOT NULL,amount DECIMAL(20,2) NOT NULL,note VARCHAR(200) NOT NULL, INDEX idx_account_date(ledger_id,account_id,entry_date)",
      ledger_refunds:
        "bill_id CHAR(36) NOT NULL,amount DECIMAL(11,2) NOT NULL,refund_date DATE NOT NULL,note VARCHAR(200) NOT NULL,account_id CHAR(36) NULL,reversed BOOLEAN NOT NULL DEFAULT FALSE, INDEX idx_refund_bill(ledger_id,bill_id)",
      ledger_transfers:
        "from_account_id CHAR(36) NOT NULL,to_account_id CHAR(36) NOT NULL,amount DECIMAL(11,2) NOT NULL,transfer_date DATE NOT NULL,note VARCHAR(200) NOT NULL,reversed BOOLEAN NOT NULL DEFAULT FALSE",
      ledger_budgets:
        "budget_month CHAR(7) NOT NULL,category_id VARCHAR(36) NOT NULL DEFAULT '',amount DECIMAL(11,2) NOT NULL,UNIQUE KEY uq_budget(ledger_id,budget_month,category_id)",
      ledger_templates: "name VARCHAR(60) NOT NULL,bill_json JSON NOT NULL",
      ledger_rules:
        "name VARCHAR(60) NOT NULL,bill_json JSON NOT NULL,frequency VARCHAR(8) NOT NULL,interval_count INT NOT NULL,start_date DATE NOT NULL,next_date DATE NOT NULL,end_date DATE NULL,mode VARCHAR(10) NOT NULL,grant_version INT NOT NULL DEFAULT 1,enabled BOOLEAN NOT NULL DEFAULT TRUE,last_error VARCHAR(200) NULL, INDEX idx_rule_due(enabled,next_date)",
      ledger_rule_runs:
        "rule_id CHAR(36) NOT NULL,occurrence_date DATE NOT NULL,bill_id CHAR(36) NULL,UNIQUE KEY uq_rule_occurrence(rule_id,occurrence_date)",
      ledger_notices:
        "user_id CHAR(36) NOT NULL,dedupe_key VARCHAR(128) NOT NULL,title VARCHAR(100) NOT NULL,body VARCHAR(400) NOT NULL,is_read BOOLEAN NOT NULL DEFAULT FALSE, UNIQUE KEY uq_notice(ledger_id,user_id,dedupe_key)",
      ledger_contacts:
        "name VARCHAR(80) NOT NULL,note VARCHAR(200) NOT NULL DEFAULT '',archived BOOLEAN NOT NULL DEFAULT FALSE,UNIQUE KEY uq_contact_name(ledger_id,name)",
      ledger_debt_adjustments:
        "debt_id CHAR(36) NOT NULL,kind VARCHAR(12) NOT NULL,amount DECIMAL(11,2) NOT NULL,adjustment_date DATE NOT NULL,note VARCHAR(200) NOT NULL,reversed BOOLEAN NOT NULL DEFAULT FALSE",
      ledger_reimbursements:
        "bill_id CHAR(36) NOT NULL,counterparty VARCHAR(80) NOT NULL,amount DECIMAL(11,2) NOT NULL,received DECIMAL(11,2) NOT NULL DEFAULT 0,status VARCHAR(12) NOT NULL DEFAULT 'requested'",
      ledger_reimbursement_receipts:
        "reimbursement_id CHAR(36) NOT NULL,amount DECIMAL(11,2) NOT NULL,receipt_date DATE NOT NULL,account_id CHAR(36) NULL,note VARCHAR(200) NOT NULL,reversed BOOLEAN NOT NULL DEFAULT FALSE",
      ledger_attachments:
        "bill_id CHAR(36) NOT NULL,resource_id CHAR(36) NOT NULL,UNIQUE KEY uq_bill_resource(ledger_id,bill_id,resource_id)",
      ledger_import_drafts:
        "user_id CHAR(36) NOT NULL,rows_json JSON NOT NULL,status VARCHAR(12) NOT NULL DEFAULT 'draft',result_json JSON NULL,expires_at DATETIME(3) NOT NULL",
      ledger_category_recents:
        "user_id CHAR(36) NOT NULL,category_id VARCHAR(36) NOT NULL,last_used_at DATETIME(3) NOT NULL,UNIQUE KEY uq_category_recent(ledger_id,user_id,category_id)",
    };
    for (const [name, columns] of Object.entries(tables))
      await q.query(
        `CREATE TABLE ${name}(id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,${columns},created_by CHAR(36) NULL,created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),INDEX idx_book(ledger_id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      );
  }
  async down() {
    throw new Error(
      "账本功能迁移包含财务记录，不支持自动回滚；请恢复完整备份。",
    );
  }
}

/** Preserve existing positions while allowing explicit non-cash adjustments. */
export class LedgerFeatureIntegrity1791244830000 implements MigrationInterface {
  name = "LedgerFeatureIntegrity1791244830000";
  async up(q: QueryRunner) {
    await q.query(
      "ALTER TABLE debt_positions DROP CHECK chk_debt_balance, ADD CONSTRAINT chk_debt_balance CHECK(amount>0 AND remaining>=0 AND settled>=0 AND adjusted>=0 AND remaining+settled+adjusted=amount)",
    );
    await q.query(
      "ALTER TABLE ledger_refunds ADD CONSTRAINT chk_refund_amount CHECK(amount>0), ADD INDEX idx_refund_period(ledger_id,reversed,refund_date)",
    );
    await q.query(
      "ALTER TABLE ledger_reimbursements ADD CONSTRAINT chk_reimbursement_balance CHECK(amount>0 AND received>=0 AND received<=amount)",
    );
    await q.query(
      "ALTER TABLE ledger_reimbursement_receipts ADD CONSTRAINT chk_receipt_amount CHECK(amount>0), ADD INDEX idx_receipt_period(ledger_id,reversed,receipt_date)",
    );
    await q.query(
      "ALTER TABLE ledger_transfers ADD CONSTRAINT chk_transfer_amount CHECK(amount>0 AND from_account_id<>to_account_id)",
    );
    await q.query(
      "ALTER TABLE ledger_budgets ADD CONSTRAINT chk_budget_amount CHECK(amount>0)",
    );
    await q.query(
      "ALTER TABLE ledger_rules ADD CONSTRAINT chk_rule_interval CHECK(interval_count>0 AND interval_count<=99)",
    );
  }
  async down() {
    throw new Error("财务约束迁移不支持自动回滚，请恢复完整备份。");
  }
}

export class LedgerRecordAttachments1791244831000 implements MigrationInterface {
  name = "LedgerRecordAttachments1791244831000";
  async up(q: QueryRunner) {
    await q.query(
      "ALTER TABLE ledger_attachments DROP INDEX uq_bill_resource, CHANGE bill_id subject_id CHAR(36) NOT NULL, ADD subject_kind VARCHAR(32) NOT NULL DEFAULT 'bill', ADD UNIQUE KEY uq_record_resource(ledger_id,subject_kind,subject_id,resource_id)",
    );
  }
  async down() {
    throw new Error("记录附件迁移包含用户文件关联，请恢复完整备份。");
  }
}
