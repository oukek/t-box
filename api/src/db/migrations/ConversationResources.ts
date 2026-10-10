import type { MigrationInterface, QueryRunner } from "typeorm";
export class ConversationResources1791244802000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      "ALTER TABLE ai_models ADD purpose ENUM('conversation','image') NOT NULL DEFAULT 'conversation', ADD supports_vision BOOLEAN NOT NULL DEFAULT FALSE",
    );
    await db.query(
      "ALTER TABLE ai_settings ADD image_model_id CHAR(36) NULL, ADD CONSTRAINT fk_image_model FOREIGN KEY(image_model_id) REFERENCES ai_models(id) ON DELETE RESTRICT",
    );
    await db.query(
      "ALTER TABLE ledger_unlocks ADD scope ENUM('read','write') NOT NULL DEFAULT 'write'",
    );
    // Existing grants also adopt the new maximum lifetime without extending them.
    await db.query(
      "UPDATE ledger_unlocks SET expires_at=LEAST(expires_at,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 10 MINUTE))",
    );
    await db.query(`CREATE TABLE resources (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL,
      name VARCHAR(200) NOT NULL, mime_type VARCHAR(80) NOT NULL, size INT UNSIGNED NOT NULL,
      source ENUM('uploaded','generated') NOT NULL, deleted_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      INDEX idx_resource_user(user_id,deleted_at,created_at),
      FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE conversations (
      id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, title VARCHAR(100) NOT NULL,
      state_json MEDIUMTEXT NOT NULL, ledger_ids JSON NOT NULL, message_count INT NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)), updated_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      INDEX idx_conversation_user(user_id,updated_at),
      FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`);
  }
  async down(): Promise<void> {
    throw new Error(
      "Conversation/resource migration requires an explicit data backup before rollback",
    );
  }
}
