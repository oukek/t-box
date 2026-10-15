import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ApplicationFiles1791244840000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE application_file_grants (
      user_id CHAR(36) NOT NULL,app_id VARCHAR(64) NOT NULL,generation INT NOT NULL,resource_id CHAR(36) NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY(user_id,app_id,generation,resource_id),
      CONSTRAINT app_file_user FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      CONSTRAINT app_file_resource FOREIGN KEY(resource_id) REFERENCES resources(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(): Promise<void> {
    throw new Error('File grants require explicit review before rollback')
  }
}
