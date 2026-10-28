import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
import { userProfileExtension } from '../../identity/profile-entity.js'
import { wechatAuthorizationExtension, wechatIdentityExtension } from '../../identity/wechat-schema.js'
import { promotionExtension } from './promotions.js'

export const identitySchema: DatabaseSchema = {
  id: 'identity',
  extensions: [wechatIdentityExtension, userProfileExtension, wechatAuthorizationExtension, promotionExtension],
  tables: [
    `CREATE TABLE admin_sessions (
      token_hash char(64) NOT NULL,
      admin_id char(36) NOT NULL,
      expires_at datetime(3) NOT NULL,
      PRIMARY KEY (token_hash),
      KEY expires_at (expires_at),
      KEY admin_id (admin_id),
      CONSTRAINT admin_sessions_ibfk_1 FOREIGN KEY (admin_id) REFERENCES admin_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE admin_users (
      id char(36) NOT NULL,
      username varchar(64) NOT NULL,
      password_hash varchar(200) NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '1',
      failed_attempts int NOT NULL DEFAULT '0',
      locked_until datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE app_users (
      id char(36) NOT NULL,
      username varchar(64) NOT NULL,
      nickname varchar(40) NOT NULL,
      password_hash varchar(200) NOT NULL,
      enabled tinyint(1) NOT NULL DEFAULT '1',
      failed_attempts int NOT NULL DEFAULT '0',
      locked_until datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (id),
      UNIQUE KEY username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE user_recovery_codes (
      user_id char(36) NOT NULL,
      code_hash char(64) NOT NULL,
      used_at datetime(3) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      PRIMARY KEY (user_id,code_hash),
      CONSTRAINT recovery_user FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE user_sessions (
      token_hash char(64) NOT NULL,
      user_id char(36) NOT NULL,
      expires_at datetime(3) NOT NULL,
      session_id char(36) NOT NULL DEFAULT (uuid()),
      device varchar(120) NOT NULL DEFAULT '未知设备',
      created_at datetime(3) NOT NULL DEFAULT (utc_timestamp(3)),
      last_seen_at datetime(3) DEFAULT NULL,
      PRIMARY KEY (token_hash),
      UNIQUE KEY user_session_id (session_id),
      KEY idx_user_session_expiry (expires_at),
      KEY user_id (user_id),
      CONSTRAINT user_sessions_ibfk_1 FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
