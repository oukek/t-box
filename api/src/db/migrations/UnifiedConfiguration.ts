import type { MigrationInterface, QueryRunner } from "typeorm";
export class UnifiedConfiguration1791244827000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query(
      `CREATE TABLE platform_configuration_state (id TINYINT PRIMARY KEY,revision BIGINT NOT NULL DEFAULT 1,ai_revision BIGINT NOT NULL DEFAULT 1) ENGINE=InnoDB`,
    );
    await db.query("INSERT INTO platform_configuration_state(id) VALUES(1)");
    await db.query(
      `CREATE TABLE platform_configurations (config_key VARCHAR(190) PRIMARY KEY,definition_json JSON NOT NULL,value_json JSON NOT NULL,updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`,
    );
    await db.query(
      `CREATE TABLE platform_configuration_history (config_key VARCHAR(190) NOT NULL,revision BIGINT NOT NULL,value_json JSON NOT NULL,administrator_id CHAR(36) NULL,note VARCHAR(500) NOT NULL DEFAULT '',created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),PRIMARY KEY(config_key,revision)) ENGINE=InnoDB`,
    );
  }
  async down(db: QueryRunner) {
    await db.query("DROP TABLE platform_configuration_history");
    await db.query("DROP TABLE platform_configurations");
    await db.query("DROP TABLE platform_configuration_state");
  }
}
