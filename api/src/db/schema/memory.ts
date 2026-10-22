import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const memorySchema: DatabaseSchema = {
  id: 'ai-memory',
  tables: [
    `CREATE TABLE ai_memory_states (
      user_id char(36) NOT NULL, enabled tinyint(1) NOT NULL DEFAULT '1', auto_extract tinyint(1) NOT NULL DEFAULT '0', auto_since datetime(3) DEFAULT NULL,
      revision int unsigned NOT NULL DEFAULT '1', epoch int unsigned NOT NULL DEFAULT '1', PRIMARY KEY (user_id),
      CONSTRAINT memory_state_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_memories (
      id char(36) NOT NULL, user_id char(36) NOT NULL, slot varchar(80) NOT NULL, label varchar(80) NOT NULL,
      content varchar(800) NOT NULL, kind varchar(20) NOT NULL, status varchar(16) NOT NULL, origin varchar(20) NOT NULL,
      version int unsigned NOT NULL DEFAULT '1', created_at datetime(3) NOT NULL, updated_at datetime(3) NOT NULL, expires_at datetime(3) DEFAULT NULL,
      PRIMARY KEY (id), UNIQUE KEY memory_slot (user_id,slot,status), KEY memory_user (user_id,status,updated_at),
      CONSTRAINT memory_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_memory_sources (
      memory_id char(36) NOT NULL, conversation_id char(36) NOT NULL, message_id varchar(100) NOT NULL,
      content_hash char(64) NOT NULL, excerpt varchar(200) NOT NULL,
      PRIMARY KEY (memory_id,conversation_id,message_id), KEY memory_source (conversation_id,message_id),
      CONSTRAINT memory_source_item FOREIGN KEY (memory_id) REFERENCES ai_memories (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE ai_memory_jobs (
      id char(64) NOT NULL, user_id char(36) NOT NULL, conversation_id char(36) NOT NULL, message_id varchar(100) NOT NULL,
      content_hash char(64) NOT NULL, epoch int unsigned NOT NULL, status varchar(16) NOT NULL, available_at datetime(3) NOT NULL,
      lease_until datetime(3) DEFAULT NULL, owner char(36) DEFAULT NULL, error varchar(240) DEFAULT NULL,
      state json NOT NULL, created_at datetime(3) NOT NULL, PRIMARY KEY (id), KEY memory_queue (status,available_at), KEY memory_job_user (user_id,conversation_id),
      CONSTRAINT memory_job_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
