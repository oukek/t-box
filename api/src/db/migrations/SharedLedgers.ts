import type { MigrationInterface, QueryRunner } from "typeorm";
export const LEGACY_LEDGER_ID = "00000000-0000-4000-8000-000000000001";
export class SharedLedgers1791244800000 implements MigrationInterface {
  async up(db: QueryRunner) {
    const tables = [
      `CREATE TABLE app_users (
        id CHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, nickname VARCHAR(40) NOT NULL,
        password_hash VARCHAR(200) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
        failed_attempts INT NOT NULL DEFAULT 0, locked_until DATETIME(3) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB`,
      `CREATE TABLE user_sessions (
        token_hash CHAR(64) PRIMARY KEY, user_id CHAR(36) NOT NULL, expires_at DATETIME(3) NOT NULL,
        INDEX idx_user_session_expiry(expires_at), FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledgers (
        id CHAR(36) PRIMARY KEY, name VARCHAR(40) NOT NULL, template ENUM('daily','debt','combined') NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'CNY', owner_id CHAR(36) NULL, archived BOOLEAN NOT NULL DEFAULT FALSE,
        password_hash VARCHAR(200) NULL, password_version INT NOT NULL DEFAULT 1, revision BIGINT NOT NULL DEFAULT 0,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), FOREIGN KEY(owner_id) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_members (
        ledger_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,role ENUM('owner','admin','editor','viewer') NOT NULL,
        joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY(ledger_id,user_id),
        FOREIGN KEY(ledger_id) REFERENCES ledgers(id), FOREIGN KEY(user_id) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_invites (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,token_hash CHAR(64) NOT NULL UNIQUE,
        role ENUM('admin','editor','viewer') NOT NULL,expires_at DATETIME(3) NOT NULL,
        max_uses INT NOT NULL,uses INT NOT NULL DEFAULT 0,revoked BOOLEAN NOT NULL DEFAULT FALSE,
        created_by CHAR(36) NOT NULL,FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(created_by) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_unlocks (
        ledger_id CHAR(36) NOT NULL,session_hash CHAR(64) NOT NULL,password_version INT NOT NULL,expires_at DATETIME(3) NOT NULL,
        PRIMARY KEY(ledger_id,session_hash),FOREIGN KEY(ledger_id) REFERENCES ledgers(id),
        FOREIGN KEY(session_hash) REFERENCES user_sessions(token_hash) ON DELETE CASCADE
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_operations (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,user_id CHAR(36) NOT NULL,
        request_key VARCHAR(128) NOT NULL,payload_hash CHAR(64) NOT NULL,action VARCHAR(50) NOT NULL,result_json JSON NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),UNIQUE KEY uq_operation_request(ledger_id,user_id,request_key),
        FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(user_id) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_audit (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,user_id CHAR(36) NULL,action VARCHAR(50) NOT NULL,
        subject_id VARCHAR(64) NULL,details JSON NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_audit_ledger_time(ledger_id,created_at),FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(user_id) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE debt_positions (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,direction ENUM('receivable','payable') NOT NULL,
        counterparty VARCHAR(80) NOT NULL,amount DECIMAL(11,2) NOT NULL,settled DECIMAL(11,2) NOT NULL DEFAULT 0,
        remaining DECIMAL(11,2) NOT NULL,occurred_date DATE NOT NULL,due_date DATE NULL,note VARCHAR(200) NOT NULL DEFAULT '',
        cash_movement BOOLEAN NOT NULL,created_by CHAR(36) NOT NULL,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_debt_ledger_direction(ledger_id,direction,remaining),UNIQUE KEY uq_debt_ledger_id(ledger_id,id),
        FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(created_by) REFERENCES app_users(id),
        CONSTRAINT chk_debt_balance CHECK(amount>0 AND remaining>=0 AND settled>=0 AND remaining+settled=amount)
      ) ENGINE=InnoDB`,
      `CREATE TABLE debt_settlements (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,direction ENUM('receivable','payable') NOT NULL,
        counterparty VARCHAR(80) NOT NULL,amount DECIMAL(14,2) NOT NULL,settled_date DATE NOT NULL,note VARCHAR(200) NOT NULL DEFAULT '',
        created_by CHAR(36) NOT NULL,reversed BOOLEAN NOT NULL DEFAULT FALSE,created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        UNIQUE KEY uq_settlement_ledger_id(ledger_id,id),INDEX idx_settlement_date(ledger_id,settled_date),
        FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(created_by) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE settlement_allocations (
        ledger_id CHAR(36) NOT NULL,settlement_id CHAR(36) NOT NULL,debt_id CHAR(36) NOT NULL,amount DECIMAL(11,2) NOT NULL,
        PRIMARY KEY(settlement_id,debt_id),FOREIGN KEY(ledger_id,settlement_id) REFERENCES debt_settlements(ledger_id,id),
        FOREIGN KEY(ledger_id,debt_id) REFERENCES debt_positions(ledger_id,id),CHECK(amount>0)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_events (
        id CHAR(36) PRIMARY KEY,ledger_id CHAR(36) NOT NULL,subject_id CHAR(36) NOT NULL,
        kind ENUM('income','expense','lend','borrow','collect','repay','correction') NOT NULL,event_date DATE NOT NULL,
        income DECIMAL(20,2) NOT NULL DEFAULT 0,expense DECIMAL(20,2) NOT NULL DEFAULT 0,
        cash_in DECIMAL(20,2) NOT NULL DEFAULT 0,cash_out DECIMAL(20,2) NOT NULL DEFAULT 0,
        receivable_delta DECIMAL(20,2) NOT NULL DEFAULT 0,payable_delta DECIMAL(20,2) NOT NULL DEFAULT 0,
        record_count INT NOT NULL DEFAULT 0,category_id VARCHAR(36) NULL,bill_type ENUM('income','expense') NULL,
        note VARCHAR(200) NOT NULL DEFAULT '',created_by CHAR(36) NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),INDEX idx_events_ledger_date(ledger_id,event_date),
        FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(category_id) REFERENCES bill_categories(id),FOREIGN KEY(created_by) REFERENCES app_users(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_daily_stats (
        ledger_id CHAR(36) NOT NULL,stat_date DATE NOT NULL,
        income DECIMAL(20,2) NOT NULL DEFAULT 0,expense DECIMAL(20,2) NOT NULL DEFAULT 0,
        cash_in DECIMAL(20,2) NOT NULL DEFAULT 0,cash_out DECIMAL(20,2) NOT NULL DEFAULT 0,
        receivable_delta DECIMAL(20,2) NOT NULL DEFAULT 0,payable_delta DECIMAL(20,2) NOT NULL DEFAULT 0,
        record_count BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(ledger_id,stat_date),FOREIGN KEY(ledger_id) REFERENCES ledgers(id)
      ) ENGINE=InnoDB`,
      `CREATE TABLE ledger_daily_categories (
        ledger_id CHAR(36) NOT NULL,stat_date DATE NOT NULL,category_id VARCHAR(36) NOT NULL,
        type ENUM('income','expense') NOT NULL,amount DECIMAL(20,2) NOT NULL DEFAULT 0,record_count BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY(ledger_id,stat_date,category_id),FOREIGN KEY(ledger_id) REFERENCES ledgers(id),FOREIGN KEY(category_id) REFERENCES bill_categories(id)
      ) ENGINE=InnoDB`,
    ];
    // DDL in MySQL commits independently. Existence checks make a failed migration resumable.
    for (const sql of tables)
      await db.query(
        sql.replace("CREATE TABLE ", "CREATE TABLE IF NOT EXISTS "),
      );
    await db.query(
      "INSERT IGNORE INTO ledgers(id,name,template) VALUES(?, '原有账本', 'combined')",
      [LEGACY_LEDGER_ID],
    );
    const column = async (table: string, name: string, definition: string) => {
      const found = await db.query(
        "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?",
        [table, name],
      );
      if (!found.length)
        await db.query(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    };
    await column(
      "bill_categories",
      "ledger_id",
      `CHAR(36) NOT NULL DEFAULT '${LEGACY_LEDGER_ID}'`,
    );
    await column("bill_categories", "sort_order", "INT NOT NULL DEFAULT 0");
    await column(
      "bills",
      "ledger_id",
      `CHAR(36) NOT NULL DEFAULT '${LEGACY_LEDGER_ID}'`,
    );
    await column("bills", "created_by", "CHAR(36) NULL");
    await column("bills", "deleted_at", "DATETIME(3) NULL");
    const constraint = async (table: string, name: string, sql: string) => {
      const found = await db.query(
        "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=? AND CONSTRAINT_NAME=?",
        [table, name],
      );
      if (!found.length) await db.query(`ALTER TABLE ${table} ADD ${sql}`);
    };
    const old = await db.query(
      "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bill_categories' AND INDEX_NAME='uq_category_type_label'",
    );
    if (old.length)
      await db.query(
        "ALTER TABLE bill_categories DROP INDEX uq_category_type_label",
      );
    await constraint(
      "bill_categories",
      "uq_book_category_label",
      "CONSTRAINT uq_book_category_label UNIQUE(ledger_id,type,label)",
    );
    await constraint(
      "bill_categories",
      "uq_book_category_id_type",
      "CONSTRAINT uq_book_category_id_type UNIQUE(ledger_id,id,type)",
    );
    await constraint(
      "bill_categories",
      "fk_category_book",
      "CONSTRAINT fk_category_book FOREIGN KEY(ledger_id) REFERENCES ledgers(id)",
    );
    await constraint(
      "bills",
      "fk_bill_book_category",
      "CONSTRAINT fk_bill_book_category FOREIGN KEY(ledger_id,category,type) REFERENCES bill_categories(ledger_id,id,type)",
    );
    await constraint(
      "bills",
      "fk_bill_author",
      "CONSTRAINT fk_bill_author FOREIGN KEY(created_by) REFERENCES app_users(id)",
    );
    const index = await db.query(
      "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='bills' AND INDEX_NAME='idx_bills_book_date'",
    );
    if (!index.length)
      await db.query(
        "ALTER TABLE bills ADD INDEX idx_bills_book_date(ledger_id,bill_date,deleted_at)",
      );
    // Exactly-once import: use the existing bill ID for its initial event.
    await db.query(`INSERT IGNORE INTO ledger_events(id,ledger_id,subject_id,kind,event_date,income,expense,cash_in,cash_out,record_count,category_id,bill_type,note)
      SELECT id,ledger_id,id,type,bill_date,IF(type='income',amount,0),IF(type='expense',amount,0),
      IF(type='income',amount,0),IF(type='expense',amount,0),1,category,type,note FROM bills WHERE deleted_at IS NULL`);
    await db.query("DELETE FROM ledger_daily_categories");
    await db.query("DELETE FROM ledger_daily_stats");
    await db.query(`INSERT INTO ledger_daily_stats SELECT ledger_id,event_date,SUM(income),SUM(expense),SUM(cash_in),SUM(cash_out),SUM(receivable_delta),SUM(payable_delta),SUM(record_count)
      FROM ledger_events GROUP BY ledger_id,event_date`);
    await db.query(`INSERT INTO ledger_daily_categories SELECT ledger_id,event_date,category_id,bill_type,SUM(income+expense),SUM(record_count)
      FROM ledger_events WHERE category_id IS NOT NULL GROUP BY ledger_id,event_date,category_id,bill_type`);
  }
  async down(): Promise<void> {
    throw new Error(
      "Shared ledger data must be restored from an explicit backup; automatic destructive rollback is disabled.",
    );
  }
}
