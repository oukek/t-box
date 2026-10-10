import type { MigrationInterface, QueryRunner } from "typeorm";
export class ApplicationLifecycleTime1791244821000 implements MigrationInterface {
  async up(db: QueryRunner) {
    const [{ offset }] = await db.query(
      "SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),CURRENT_TIMESTAMP()) AS offset",
    );
    if (Number(offset)) {
      await db.query(
        "UPDATE application_lifecycle_operations SET next_attempt_at=DATE_SUB(next_attempt_at,INTERVAL ? SECOND) WHERE status='queued'",
        [Number(offset)],
      );
      await db.query(
        "UPDATE application_lifecycle_operations SET updated_at=IF(updated_at=created_at,DATE_SUB(updated_at,INTERVAL ? SECOND),updated_at),created_at=DATE_SUB(created_at,INTERVAL ? SECOND)",
        [Number(offset), Number(offset)],
      );
    }
  }
  async down() {
    throw new Error("Lifecycle timestamps cannot be converted back safely");
  }
}
