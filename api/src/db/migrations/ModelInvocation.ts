import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ModelInvocation1791244825000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.query(
      'ALTER TABLE ai_models ADD invocation_mode ENUM(\'responses\',\'chat_completions\',\'images\') NOT NULL DEFAULT \'responses\'',
    )
    await db.query(
      'UPDATE ai_models SET invocation_mode=\'images\' WHERE purpose=\'image\'',
    )
  }

  async down(db: QueryRunner): Promise<void> {
    await db.query('ALTER TABLE ai_models DROP COLUMN invocation_mode')
  }
}
