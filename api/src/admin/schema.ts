export async function initializeAdminSchema(db: {
  query(sql: string): Promise<unknown>
}) {
  const tables = [
    `CREATE TABLE IF NOT EXISTS admin_users (
      id CHAR(36) PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(200) NOT NULL, enabled BOOLEAN NOT NULL DEFAULT TRUE,
      failed_attempts INT NOT NULL DEFAULT 0, locked_until DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash CHAR(64) PRIMARY KEY, admin_id CHAR(36) NOT NULL,
      expires_at DATETIME(3) NOT NULL, INDEX(expires_at),
      FOREIGN KEY(admin_id) REFERENCES admin_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_providers (
      id CHAR(36) PRIMARY KEY, name VARCHAR(80) NOT NULL,
      base_url VARCHAR(500) NOT NULL, key_cipher TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      revision INT NOT NULL DEFAULT 1,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_models (
      id CHAR(36) PRIMARY KEY, provider_id CHAR(36) NOT NULL,
      model_id VARCHAR(200) NOT NULL, name VARCHAR(80) NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      UNIQUE KEY(provider_id, model_id),
      FOREIGN KEY(provider_id) REFERENCES ai_providers(id) ON DELETE RESTRICT
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS ai_settings (
      id TINYINT PRIMARY KEY, model_id CHAR(36) NULL,
      FOREIGN KEY(model_id) REFERENCES ai_models(id) ON DELETE RESTRICT,
      CONSTRAINT single_ai_settings CHECK(id = 1)
    ) ENGINE=InnoDB`,
    `INSERT IGNORE INTO ai_settings (id, model_id) VALUES (1, NULL)`,
  ]
  for (const sql of tables) {
    await db.query(sql)
  }
}
