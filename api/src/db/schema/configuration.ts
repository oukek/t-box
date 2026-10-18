import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const configurationSchema: DatabaseSchema = {
  id: 'configuration',
  async seed(db) {
    await db.query('INSERT INTO platform_configuration_state(id) VALUES(1)')
    await db.query('INSERT INTO support_settings(id) VALUES(1)')
  },
  tables: [
    `CREATE TABLE platform_configuration_history (
      config_key varchar(190) NOT NULL,
      revision bigint NOT NULL,
      value_json json NOT NULL,
      administrator_id char(36) DEFAULT NULL,
      note varchar(500) NOT NULL DEFAULT '',
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (config_key,revision)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE platform_configuration_state (
      id tinyint NOT NULL,
      revision bigint NOT NULL DEFAULT '1',
      ai_revision bigint NOT NULL DEFAULT '1',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE platform_configurations (
      config_key varchar(190) NOT NULL,
      definition_json json NOT NULL,
      value_json json NOT NULL,
      updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (config_key)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE support_settings (
      id tinyint NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '0',
      qr_code_url varchar(2048) NOT NULL DEFAULT '',
      updated_at datetime DEFAULT NULL,
      updated_by char(36) DEFAULT NULL,
      PRIMARY KEY (id),
      CONSTRAINT single_support_settings CHECK ((id = 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
