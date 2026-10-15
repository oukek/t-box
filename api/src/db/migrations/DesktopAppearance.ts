import type { MigrationInterface, QueryRunner } from 'typeorm'

export class DesktopAppearance1791244836000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE user_desktop_appearance (
      user_id CHAR(36) PRIMARY KEY,
      wallpapers JSON NOT NULL,
      revision INT UNSIGNED NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      CONSTRAINT desktop_appearance_owner_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down() {
    throw new Error('Desktop appearance requires a backup before rollback')
  }
}
