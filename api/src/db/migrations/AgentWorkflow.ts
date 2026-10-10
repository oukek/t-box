import type { MigrationInterface, QueryRunner } from "typeorm";
import { defaultWorkflowPrompts } from "../../agent-workflow/defaults.js";
export class AgentWorkflow1791244823000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(`CREATE TABLE IF NOT EXISTS ai_workflow_configurations (
      revision INT PRIMARY KEY, prompts_json JSON NOT NULL,
      administrator_id CHAR(36) NULL, created_at DATETIME(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3))
    ) ENGINE=InnoDB`);
    await db.query(`CREATE TABLE IF NOT EXISTS ai_workflow_settings (
      id TINYINT PRIMARY KEY, revision INT NOT NULL,
      CONSTRAINT single_workflow_settings CHECK (id=1),
      CONSTRAINT fk_workflow_revision FOREIGN KEY(revision) REFERENCES ai_workflow_configurations(revision)
    ) ENGINE=InnoDB`);
    await db.query(
      "INSERT IGNORE INTO ai_workflow_configurations(revision,prompts_json) VALUES(1,?)",
      [JSON.stringify(defaultWorkflowPrompts)],
    );
    await db.query(
      "INSERT IGNORE INTO ai_workflow_settings(id,revision) VALUES(1,1)",
    );
  }
  async down(db: QueryRunner) {
    await db.query("DROP TABLE ai_workflow_settings");
    await db.query("DROP TABLE ai_workflow_configurations");
  }
}
