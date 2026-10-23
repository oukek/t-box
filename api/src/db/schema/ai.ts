import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import { defaultWorkflowPrompts } from '../../agent-workflow/defaults.js'

export const aiSchema: DatabaseSchema = {
  id: 'ai',
  async seed(db) {
    await db.query('INSERT INTO ai_settings(id) VALUES(1)')
    await db.query('INSERT INTO ai_cost_guard(id) VALUES(1)')
    await db.query(
      'INSERT INTO ai_model_route_guard(purpose) VALUES(\'conversation\'),(\'image\')',
    )
    await db.query(
      'INSERT INTO ai_workflow_configurations(revision,prompts_json) VALUES(1,?)',
      [JSON.stringify(defaultWorkflowPrompts)],
    )
    await db.query('INSERT INTO ai_workflow_settings(id,revision) VALUES(1,1)')
  },
  tables: [
    `CREATE TABLE agent_task_tools (
      task_id char(36) NOT NULL,
      call_id varchar(100) NOT NULL,
      name varchar(64) NOT NULL,
      agent_id varchar(64) NOT NULL,
      fingerprint char(64) NOT NULL,
      effect varchar(24) NOT NULL,
      status varchar(24) NOT NULL,
      result_json mediumtext,
      updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      execution_key char(64) DEFAULT NULL,
      PRIMARY KEY (task_id,call_id),
      UNIQUE KEY task_effect_once (task_id,execution_key),
      CONSTRAINT task_tools_parent FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE agent_tasks (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      conversation_id char(36) NOT NULL,
      request_id varchar(100) NOT NULL,
      status varchar(24) NOT NULL,
      active_key char(36) DEFAULT NULL,
      agent_id varchar(64) NOT NULL,
      checkpoint_json mediumtext NOT NULL,
      lease_owner char(36) DEFAULT NULL,
      lease_until datetime(3) DEFAULT NULL,
      cancel_requested tinyint(1) NOT NULL DEFAULT '0',
      reason varchar(200) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      recovery_auth_hash char(64) DEFAULT NULL,
      recovery_ready tinyint(1) NOT NULL DEFAULT '0',
      recovery_attempts int unsigned NOT NULL DEFAULT '0',
      recovery_after datetime(3) DEFAULT NULL,
      recovery_claim char(36) DEFAULT NULL,
      recovery_claim_until datetime(3) DEFAULT NULL,
      PRIMARY KEY (id),
      UNIQUE KEY task_request (conversation_id,request_id),
      UNIQUE KEY active_key (active_key),
      KEY task_user (user_id,updated_at),
      KEY task_recovery (status,lease_until),
      KEY task_background (recovery_ready,recovery_after),
      KEY task_updated (updated_at,id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_cost_guard (
      id int NOT NULL,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_model_calls (
      id char(36) NOT NULL,
      logical_id char(36) NOT NULL,
      retry_index int unsigned NOT NULL DEFAULT '0',
      task_id char(36) DEFAULT NULL,
      message_id char(36) DEFAULT NULL,
      user_id char(36) NOT NULL,
      provider_id char(36) NOT NULL,
      provider_name varchar(80) NOT NULL,
      model_id char(36) NOT NULL,
      model_name varchar(80) NOT NULL,
      remote_model varchar(200) NOT NULL,
      invocation_mode varchar(32) NOT NULL,
      purpose varchar(32) NOT NULL,
      method varchar(32) NOT NULL,
      status varchar(24) NOT NULL,
      input_json mediumtext NOT NULL,
      output_json mediumtext,
      user_error varchar(500) DEFAULT NULL,
      diagnostics_json text,
      provider_request_id varchar(256) DEFAULT NULL,
      response_id varchar(256) DEFAULT NULL,
      input_tokens bigint unsigned DEFAULT NULL,
      output_tokens bigint unsigned DEFAULT NULL,
      cached_tokens bigint unsigned DEFAULT NULL,
      reasoning_tokens bigint unsigned DEFAULT NULL,
      images int unsigned DEFAULT NULL,
      duration_ms int unsigned DEFAULT NULL,
      queue_ms int unsigned DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      started_at datetime(3) DEFAULT NULL,
      finished_at datetime(3) DEFAULT NULL,
      lease_until datetime(3) NOT NULL,
      PRIMARY KEY (id),
      KEY call_task (task_id,created_at,id),
      KEY call_recent (created_at,id),
      KEY call_user (user_id,created_at),
      KEY call_recovery (status,lease_until),
      KEY call_model (model_id,created_at),
      CONSTRAINT call_user_fk FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_model_pool (
      purpose varchar(24) NOT NULL,
      model_id char(36) NOT NULL,
      position int NOT NULL DEFAULT '0',
      PRIMARY KEY (purpose,model_id),
      KEY pool_position (purpose,position)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_model_route_guard (
      purpose varchar(24) NOT NULL,
      sequence bigint unsigned NOT NULL DEFAULT '0',
      PRIMARY KEY (purpose)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_model_routing (
      model_id char(36) NOT NULL,
      last_selected bigint unsigned NOT NULL DEFAULT '0',
      failures int unsigned NOT NULL DEFAULT '0',
      cooldown_until datetime(3) DEFAULT NULL,
      last_error varchar(80) DEFAULT NULL,
      PRIMARY KEY (model_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_models (
      id char(36) NOT NULL,
      provider_id char(36) NOT NULL,
      model_id varchar(200) NOT NULL,
      name varchar(80) NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '1',
      purpose enum('conversation','image') NOT NULL DEFAULT 'conversation',
      image_tiers json NOT NULL DEFAULT (JSON_ARRAY('1k')),
      image_prices json DEFAULT NULL,
      supports_vision tinyint(1) NOT NULL DEFAULT '0',
      supports_reasoning tinyint(1) NOT NULL DEFAULT '0',
      cost_multiplier decimal(10,6) NOT NULL DEFAULT '1',
      input_price decimal(18,6) NOT NULL DEFAULT '0.000000',
      output_price decimal(18,6) NOT NULL DEFAULT '0.000000',
      image_price decimal(18,6) NOT NULL DEFAULT '0.000000',
      context_policy json DEFAULT NULL,
      invocation_mode enum('responses','chat_completions','images') NOT NULL DEFAULT 'responses',
      max_concurrency int unsigned NOT NULL DEFAULT '4',
      PRIMARY KEY (id),
      UNIQUE KEY provider_id (provider_id,model_id),
      CONSTRAINT ai_models_ibfk_1 FOREIGN KEY (provider_id) REFERENCES ai_providers (id) ON DELETE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_provider_leases (
      id char(36) NOT NULL,
      provider_id char(36) NOT NULL,
      expires_at datetime(3) NOT NULL,
      model_id char(36) DEFAULT NULL,
      PRIMARY KEY (id),
      KEY provider_active (provider_id,expires_at),
      KEY model_active (model_id,expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_provider_pools (
      provider_id char(36) NOT NULL,
      PRIMARY KEY (provider_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_providers (
      id char(36) NOT NULL,
      name varchar(80) NOT NULL,
      base_url varchar(500) NOT NULL,
      key_cipher text NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '1',
      revision int NOT NULL DEFAULT '1',
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      max_concurrency int unsigned NOT NULL DEFAULT '0',
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_settings (
      id tinyint NOT NULL,
      model_id char(36) DEFAULT NULL,
      image_model_id char(36) DEFAULT NULL,
      PRIMARY KEY (id),
      KEY model_id (model_id),
      KEY fk_image_model (image_model_id),
      CONSTRAINT ai_settings_ibfk_1 FOREIGN KEY (model_id) REFERENCES ai_models (id) ON DELETE RESTRICT,
      CONSTRAINT fk_image_model FOREIGN KEY (image_model_id) REFERENCES ai_models (id) ON DELETE RESTRICT,
      CONSTRAINT single_ai_settings CHECK ((id = 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_workflow_configurations (
      revision int NOT NULL,
      prompts_json json NOT NULL,
      administrator_id char(36) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (revision)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_workflow_settings (
      id tinyint NOT NULL,
      revision int NOT NULL,
      PRIMARY KEY (id),
      KEY fk_workflow_revision (revision),
      CONSTRAINT fk_workflow_revision FOREIGN KEY (revision) REFERENCES ai_workflow_configurations (revision),
      CONSTRAINT single_workflow_settings CHECK ((id = 1))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE conversation_answer_versions (
      conversation_id char(36) NOT NULL,
      message_id char(36) NOT NULL,
      replacement_request_id varchar(100) NOT NULL,
      revision int unsigned NOT NULL,
      snapshot_json json NOT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (conversation_id,message_id,replacement_request_id),
      KEY idx_answer_versions (conversation_id,message_id,revision),
      CONSTRAINT fk_answer_version_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE conversations (
      id char(36) NOT NULL,
      user_id char(36) NOT NULL,
      title varchar(100) NOT NULL,
      state_json mediumtext NOT NULL,
      resource_refs json NOT NULL,
      message_count int NOT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      updated_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      revision bigint unsigned NOT NULL DEFAULT '1',
      title_source enum('pending','generated','manual') NOT NULL DEFAULT 'generated',
      PRIMARY KEY (id),
      KEY idx_conversation_user (user_id,updated_at),
      CONSTRAINT conversations_ibfk_1 FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
