import type { MigrationInterface, QueryRunner } from "typeorm";
export class ApplicationPublishing1791244819000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE application_registry (
      app_id VARCHAR(64) PRIMARY KEY, kind VARCHAR(16) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`);
    await db.query(`INSERT INTO application_registry(app_id,kind)
      SELECT app_id,IF(app_id='ledger','user','system') FROM application_releases
      WHERE app_id IN ('ledger','calculator','calendar','time','profile','market') GROUP BY app_id`);
    await db.query(`INSERT IGNORE INTO application_registry(app_id,kind)
      SELECT app_id,JSON_UNQUOTE(JSON_EXTRACT(definition,'$.kind')) FROM application_releases`);
    await db.query(`ALTER TABLE application_releases
      ADD status VARCHAR(16) NOT NULL DEFAULT 'draft',
      ADD revision INT UNSIGNED NOT NULL DEFAULT 1,
      ADD release_notes TEXT NULL,
      ADD submitted_by CHAR(36) NULL,
      ADD submitted_at DATETIME(3) NULL,
      ADD published_by CHAR(36) NULL,
      ADD published_at DATETIME(3) NULL`);
    await db.query(
      `UPDATE application_releases SET status=IF(published=1,'published','retired'),published_at=created_at`,
    );
    await db.query(`CREATE TABLE application_publication_events (
      id CHAR(36) PRIMARY KEY, app_id VARCHAR(64) NOT NULL, release_id VARCHAR(80) NOT NULL,
      action VARCHAR(24) NOT NULL, administrator_id CHAR(36) NOT NULL, detail JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      INDEX app_publication_history(app_id,created_at)
    ) ENGINE=InnoDB`);
  }
  async down() {
    throw new Error("Application publication rollback requires a backup");
  }
}
