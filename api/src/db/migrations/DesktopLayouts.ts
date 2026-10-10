import type { MigrationInterface, QueryRunner } from "typeorm";
export class DesktopLayouts1791244817000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE user_desktop_layouts (
      user_id CHAR(36) NOT NULL, device VARCHAR(12) NOT NULL,
      app_ids JSON NOT NULL, revision INT UNSIGNED NOT NULL DEFAULT 1,
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY(user_id,device),
      CONSTRAINT desktop_owner_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down() {
    throw new Error("Desktop layouts require a backup before rollback");
  }
}
