import type { MigrationInterface, QueryRunner } from "typeorm";

/** Application contracts belong to their releases, never platform AI settings. */
export class RetireApplicationConfiguration1791244828000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      "DELETE FROM platform_configurations WHERE config_key LIKE 'apps.%'",
    );
    // Keep former publication history for audit, but never load or edit retired keys.
    await db.query(
      "UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1",
    );
    await db.query(
      "UPDATE platform_configuration_history SET note='平台默认配置' WHERE revision=0 AND note='应用默认配置' AND config_key NOT LIKE 'apps.%'",
    );
  }
  async down(db: QueryRunner) {
    // The preceding runtime re-registers its defaults; immutable history is retained.
    await db.query(
      "UPDATE platform_configuration_state SET revision=revision+1 WHERE id=1",
    );
  }
}
