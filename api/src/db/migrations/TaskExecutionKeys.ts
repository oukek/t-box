import type { MigrationInterface, QueryRunner } from "typeorm";
export class TaskExecutionKeys1791244805000 implements MigrationInterface {
  async up(db: QueryRunner) {
    if (!(await db.hasColumn("agent_task_tools", "execution_key")))
      await db.query(
        "ALTER TABLE agent_task_tools ADD execution_key CHAR(64) NULL, ADD UNIQUE KEY task_effect_once (task_id,execution_key)",
      );
  }
  async down(): Promise<void> {
    throw new Error(
      "Task execution keys require an explicit backup before rollback",
    );
  }
}
