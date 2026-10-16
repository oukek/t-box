import type { MigrationInterface, QueryRunner } from 'typeorm'

export class ModelPools1791244847000 implements MigrationInterface {
  async up(db: QueryRunner) {
    await db.query('ALTER TABLE ai_providers ADD max_concurrency INT UNSIGNED NOT NULL DEFAULT 0')
    await db.query('ALTER TABLE ai_models ADD max_concurrency INT UNSIGNED NOT NULL DEFAULT 4')
    await db.query(`CREATE TABLE ai_model_pool (
      purpose VARCHAR(24) NOT NULL,model_id CHAR(36) NOT NULL,position INT NOT NULL DEFAULT 0,
      PRIMARY KEY(purpose,model_id),KEY pool_position(purpose,position)
    ) ENGINE=InnoDB`)
    await db.query('INSERT INTO ai_model_pool(purpose,model_id) SELECT \'conversation\',model_id FROM ai_settings WHERE model_id IS NOT NULL')
    await db.query('INSERT INTO ai_model_pool(purpose,model_id) SELECT \'image\',image_model_id FROM ai_settings WHERE image_model_id IS NOT NULL')
    await db.query(`CREATE TABLE ai_model_routing (
      model_id CHAR(36) PRIMARY KEY,last_selected BIGINT UNSIGNED NOT NULL DEFAULT 0,
      failures INT UNSIGNED NOT NULL DEFAULT 0,cooldown_until DATETIME(3) NULL,last_error VARCHAR(80) NULL
    ) ENGINE=InnoDB`)
    await db.query('CREATE TABLE ai_model_route_guard (purpose VARCHAR(24) PRIMARY KEY,sequence BIGINT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB')
    await db.query('INSERT INTO ai_model_route_guard(purpose) VALUES(\'conversation\'),(\'image\')')
    await db.query('ALTER TABLE ai_provider_leases ADD model_id CHAR(36) NULL,ADD KEY model_active(model_id,expires_at)')
    await db.query(`CREATE TABLE ai_model_calls (
      id CHAR(36) PRIMARY KEY,logical_id CHAR(36) NOT NULL,retry_index INT UNSIGNED NOT NULL DEFAULT 0,
      task_id CHAR(36) NULL,message_id CHAR(36) NULL,user_id CHAR(36) NOT NULL,
      provider_id CHAR(36) NOT NULL,provider_name VARCHAR(80) NOT NULL,
      model_id CHAR(36) NOT NULL,model_name VARCHAR(80) NOT NULL,remote_model VARCHAR(200) NOT NULL,
      invocation_mode VARCHAR(32) NOT NULL,purpose VARCHAR(32) NOT NULL,method VARCHAR(32) NOT NULL,
      status VARCHAR(24) NOT NULL,input_json MEDIUMTEXT NOT NULL,output_json MEDIUMTEXT NULL,
      user_error VARCHAR(500) NULL,diagnostics_json TEXT NULL,provider_request_id VARCHAR(256) NULL,response_id VARCHAR(256) NULL,
      input_tokens BIGINT UNSIGNED NULL,output_tokens BIGINT UNSIGNED NULL,cached_tokens BIGINT UNSIGNED NULL,
      reasoning_tokens BIGINT UNSIGNED NULL,images INT UNSIGNED NULL,
      duration_ms INT UNSIGNED NULL,queue_ms INT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),started_at DATETIME(3) NULL,finished_at DATETIME(3) NULL,
      lease_until DATETIME(3) NOT NULL,
      KEY call_task(task_id,created_at,id),KEY call_recent(created_at,id),KEY call_user(user_id,created_at),
      KEY call_recovery(status,lease_until),KEY call_model(model_id,created_at),
      CONSTRAINT call_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
    await db.query('UPDATE platform_configuration_state SET ai_revision=ai_revision+1 WHERE id=1')
  }

  async down(): Promise<void> {
    throw new Error('Model routing and request audit require an explicit backup before rollback')
  }
}
