import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AnswerVersions1791244824000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS conversation_answer_versions (
      conversation_id CHAR(36) NOT NULL,
      message_id CHAR(36) NOT NULL,
      replacement_request_id VARCHAR(100) NOT NULL,
      revision INT UNSIGNED NOT NULL,
      snapshot_json JSON NOT NULL,
      created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      PRIMARY KEY(conversation_id,message_id,replacement_request_id),
      INDEX idx_answer_versions(conversation_id,message_id,revision),
      CONSTRAINT fk_answer_version_conversation FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`)
  }

  async down(db: QueryRunner) {
    await db.query('DROP TABLE conversation_answer_versions')
  }
}
