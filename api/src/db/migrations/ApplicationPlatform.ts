import type { MigrationInterface, QueryRunner } from "typeorm";
export class ApplicationPlatform1791244818000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS application_releases (
      release_id VARCHAR(80) PRIMARY KEY, app_id VARCHAR(64) NOT NULL,
      definition JSON NOT NULL, definition_hash CHAR(64) NOT NULL,
      published TINYINT NOT NULL DEFAULT 1, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX application_catalog(app_id,published)
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS application_installations (
      user_id CHAR(36) NOT NULL, app_id VARCHAR(64) NOT NULL,
      release_id VARCHAR(80) NOT NULL, target_release_id VARCHAR(80) NULL,
      generation INT UNSIGNED NOT NULL DEFAULT 1,
      status VARCHAR(20) NOT NULL, grants JSON NOT NULL, operation_id CHAR(36) NULL,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY(user_id,app_id),
      CONSTRAINT app_install_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS application_lifecycle_operations (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, app_id VARCHAR(64) NOT NULL,
      request_key VARCHAR(80) NOT NULL, request_hash CHAR(64) NOT NULL,
      release_id VARCHAR(80) NOT NULL, generation INT UNSIGNED NOT NULL,
      action VARCHAR(16) NOT NULL, status VARCHAR(20) NOT NULL DEFAULT 'queued',
      submitted TINYINT NOT NULL DEFAULT 0, attempts INT UNSIGNED NOT NULL DEFAULT 0,
      lease_token CHAR(36) NULL, lease_until DATETIME(3) NULL,
      next_attempt_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      receipt JSON NULL, error VARCHAR(300) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      UNIQUE KEY app_operation_request(user_id,app_id,request_key),
      INDEX app_operation_queue(status,next_attempt_at,lease_until),
      CONSTRAINT app_operation_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down() {
    throw new Error("Application installation rollback requires a backup");
  }
}
