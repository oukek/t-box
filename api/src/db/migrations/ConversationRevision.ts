import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ConversationRevision1791244806000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn('conversations', 'revision'))) {
      await db.query(
        'ALTER TABLE conversations ADD revision BIGINT UNSIGNED NOT NULL DEFAULT 1',
      )
    }
  }

  async down(): Promise<void> {
    throw new Error(
      'Conversation revisions require an explicit backup before rollback',
    )
  }
}
