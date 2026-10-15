import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AccountSecurity1791244844000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`ALTER TABLE user_sessions ADD session_id CHAR(36) NULL,ADD device VARCHAR(120) NOT NULL DEFAULT '未知设备',
      ADD created_at DATETIME(3) NULL,ADD last_seen_at DATETIME(3) NULL`)
    await db.query('UPDATE user_sessions SET session_id=UUID(),created_at=DATE_SUB(expires_at,INTERVAL 7 DAY)')
    await db.query('ALTER TABLE user_sessions MODIFY session_id CHAR(36) NOT NULL DEFAULT (UUID()),MODIFY created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),ADD UNIQUE KEY user_session_id(session_id)')
    await db.query(`CREATE TABLE user_recovery_codes (
      user_id CHAR(36) NOT NULL,code_hash CHAR(64) NOT NULL,used_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),PRIMARY KEY(user_id,code_hash),
      CONSTRAINT recovery_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('Account recovery cannot be rolled back without invalidating recovery codes and sessions')
  }
}
