import type { MigrationInterface, QueryRunner } from 'typeorm'

export class CustomerSupport1791244813000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS support_settings (
      id TINYINT PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT FALSE,
      qr_code_url VARCHAR(2048) NOT NULL DEFAULT '',
      updated_at DATETIME NULL,
      updated_by CHAR(36) NULL,
      CONSTRAINT single_support_settings CHECK (id = 1)
    ) ENGINE=InnoDB`)
    await db.query('INSERT IGNORE INTO support_settings(id) VALUES(1)')
  }

  async down(db: QueryRunner) {
    await db.query('DROP TABLE support_settings')
  }
}
