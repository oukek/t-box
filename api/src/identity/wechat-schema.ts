export const wechatIdentityExtension = {
  id: '2026-10-28-wechat-identity',
  tables: [
    `CREATE TABLE wechat_account_settings (
      id tinyint NOT NULL PRIMARY KEY,
      revision int NOT NULL DEFAULT 0,
      enabled tinyint(1) NOT NULL DEFAULT 0,
      app_id varchar(64) NOT NULL DEFAULT '',
      frontend_url varchar(1024) NOT NULL DEFAULT '',
      app_secret_cipher text NOT NULL,
      updated_by char(36) DEFAULT NULL,
      updated_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      CONSTRAINT single_wechat_account CHECK(id=1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE wechat_identities (
      app_id varchar(64) NOT NULL,
      openid_hash char(64) NOT NULL,
      user_id char(36) NOT NULL,
      openid_cipher text NOT NULL,
      avatar_url varchar(2048) NOT NULL DEFAULT '',
      updated_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      PRIMARY KEY(app_id,openid_hash),
      UNIQUE KEY wechat_identity_user(app_id,user_id),
      CONSTRAINT wechat_identity_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE wechat_login_flows (
      id char(36) NOT NULL PRIMARY KEY,
      kind enum('login','qr','scan') NOT NULL,
      secret_hash char(64) NOT NULL,
      state_hash char(64) DEFAULT NULL,
      app_id varchar(64) NOT NULL,
      parent_id char(36) DEFAULT NULL,
      device varchar(120) NOT NULL,
      status enum('pending','exchanging','scanned','complete','cancelled','failed') NOT NULL DEFAULT 'pending',
      user_id char(36) DEFAULT NULL,
      session_cipher text DEFAULT NULL,
      session_hash char(64) DEFAULT NULL,
      checkout_token_hash char(64) DEFAULT NULL,
      expires_at datetime(3) NOT NULL,
      created_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY wechat_login_state(state_hash),
      KEY wechat_flow_expiry(expires_at),
      KEY wechat_flow_parent(parent_id),
      KEY wechat_checkout_authorization(checkout_token_hash,session_hash),
      CONSTRAINT wechat_flow_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
