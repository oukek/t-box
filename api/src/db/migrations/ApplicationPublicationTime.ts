import type { MigrationInterface, QueryRunner } from "typeorm";
/** Historical release metadata used the DB session's CURRENT_TIMESTAMP; publication operations use UTC. */
export class ApplicationPublicationTime1791244820000 implements MigrationInterface {
  async up(db: QueryRunner) {
    const [{ offset }] = await db.query(
      "SELECT TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(),CURRENT_TIMESTAMP()) AS offset",
    );
    if (Number(offset)) {
      for (const table of [
        "application_registry",
        "application_releases",
        "application_publication_events",
      ])
        await db.query(
          `UPDATE ${table} SET created_at=DATE_SUB(created_at,INTERVAL ? SECOND)`,
          [Number(offset)],
        );
      await db.query(
        "UPDATE application_releases SET published_at=DATE_SUB(published_at,INTERVAL ? SECOND) WHERE published_by IS NULL AND published_at IS NOT NULL",
        [Number(offset)],
      );
    }
  }
  async down() {
    throw new Error("Publication timestamps cannot be converted back safely");
  }
}
