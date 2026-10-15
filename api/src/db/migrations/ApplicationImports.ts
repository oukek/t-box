import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ApplicationImports1791244834000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE application_import_credentials (
      id CHAR(36) PRIMARY KEY, token_hash CHAR(64) NOT NULL UNIQUE,
      administrator_id CHAR(36) NOT NULL, apps JSON NOT NULL,
      expires_at DATETIME(3) NOT NULL, revoked_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
    ) ENGINE=InnoDB`)
    await db.query(`CREATE TABLE application_build_imports (
      app_id VARCHAR(64) NOT NULL, version VARCHAR(48) NOT NULL,
      release_id VARCHAR(80) NOT NULL UNIQUE, bundle_sha256 CHAR(64) NOT NULL,
      object_url VARCHAR(1000) NOT NULL, source JSON NOT NULL,
      credential_id CHAR(36) NOT NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      PRIMARY KEY(app_id,version)
    ) ENGINE=InnoDB`)
  }

  async down() {
    throw new Error('Application imports rollback requires a backup')
  }
}
