export const promotionExtension = {
  id: '2026-10-28-promotion-attribution',
  tables: [
    `CREATE TABLE promotion_sources (
      id char(36) NOT NULL PRIMARY KEY,
      token char(32) NOT NULL,
      kind enum('channel','user') NOT NULL,
      owner_user_id char(36) DEFAULT NULL,
      name varchar(80) NOT NULL,
      description_note varchar(300) NOT NULL DEFAULT '',
      enabled tinyint(1) NOT NULL DEFAULT 1,
      revision int NOT NULL DEFAULT 1,
      created_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      UNIQUE KEY promotion_token(token),
      UNIQUE KEY promotion_owner(owner_user_id),
      CONSTRAINT promotion_source_kind CHECK ((kind='channel' AND owner_user_id IS NULL) OR (kind='user' AND owner_user_id IS NOT NULL)),
      CONSTRAINT promotion_owner_fk FOREIGN KEY(owner_user_id) REFERENCES app_users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE promotion_registrations (
      user_id char(36) NOT NULL PRIMARY KEY,
      source_id char(36) NOT NULL,
      created_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
      KEY promotion_registration_source(source_id,user_id),
      CONSTRAINT promotion_registered_user_fk FOREIGN KEY(user_id) REFERENCES app_users(id) ON DELETE CASCADE,
      CONSTRAINT promotion_registration_source_fk FOREIGN KEY(source_id) REFERENCES promotion_sources(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE promotion_login_flows (
      flow_id char(36) NOT NULL PRIMARY KEY,
      source_id char(36) NOT NULL,
      CONSTRAINT promotion_login_flow_fk FOREIGN KEY(flow_id) REFERENCES wechat_login_flows(id) ON DELETE CASCADE,
      CONSTRAINT promotion_flow_source_fk FOREIGN KEY(source_id) REFERENCES promotion_sources(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}

export const promotionCreativeExtension = {
  id: '2026-10-29-promotion-creatives',
  tables: [`CREATE TABLE promotion_assets (
    id char(36) NOT NULL PRIMARY KEY,
    kind enum('thumbnail','poster') NOT NULL,
    backend varchar(64) NOT NULL,
    path varchar(600) NOT NULL,
    width int NOT NULL,
    height int NOT NULL,
    size int NOT NULL,
    uploaded_by char(36) DEFAULT NULL,
    created_at datetime(3) NOT NULL DEFAULT (UTC_TIMESTAMP(3)),
    CONSTRAINT promotion_asset_administrator_fk FOREIGN KEY(uploaded_by) REFERENCES admin_users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
}
