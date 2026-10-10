import type { MigrationInterface, QueryRunner } from "typeorm";
import { upgradeDefaultWorkflow } from "../../agent-workflow/default-upgrade.js";

/** Append a version for untouched defaults; never overwrite user prompts or task snapshots. */
export class WorkflowPhaseIsolation1791244826000 implements MigrationInterface {
  async up(db: QueryRunner): Promise<void> {
    await db.startTransaction();
    try {
      const [current] = await db.query(
        "SELECT s.revision,c.prompts_json FROM ai_workflow_settings s JOIN ai_workflow_configurations c ON c.revision=s.revision WHERE s.id=1 FOR UPDATE",
      );
      const upgraded = current && upgradeDefaultWorkflow(current.prompts_json);
      if (upgraded) {
        const [last] = await db.query(
          "SELECT MAX(revision) AS revision FROM ai_workflow_configurations",
        );
        const revision = Number(last.revision) + 1;
        await db.query(
          "INSERT INTO ai_workflow_configurations(revision,prompts_json) VALUES(?,?)",
          [revision, JSON.stringify(upgraded)],
        );
        await db.query(
          "UPDATE ai_workflow_settings SET revision=? WHERE id=1",
          [revision],
        );
      }
      await db.commitTransaction();
    } catch (error) {
      await db.rollbackTransaction();
      throw error;
    }
  }
  // Published prompt revisions are audit records. Downgrading code must not delete them.
  async down(): Promise<void> {}
}
