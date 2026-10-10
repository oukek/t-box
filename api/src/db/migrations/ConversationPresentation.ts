import type { MigrationInterface, QueryRunner } from "typeorm";
export class ConversationPresentation1791244807000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn("conversations", "title_source"))) {
      // Existing titles are retained; only newly created conversations schedule generation.
      await db.query(
        "ALTER TABLE conversations ADD title_source ENUM('pending','generated','manual') NOT NULL DEFAULT 'generated'",
      );
    }
    if (!(await db.hasColumn("ai_models", "supports_reasoning")))
      await db.query(
        "ALTER TABLE ai_models ADD supports_reasoning BOOLEAN NOT NULL DEFAULT FALSE",
      );
  }
  async down(): Promise<void> {
    throw new Error(
      "Conversation presentation requires an explicit backup before rollback",
    );
  }
}
