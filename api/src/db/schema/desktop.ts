import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const desktopSchema: DatabaseSchema = {
  id: 'desktop',
  extensions: [{
    id: '2026-11-25.system-version-reservations',
    tables: [`CREATE TABLE system_version_cursor (
      id tinyint unsigned NOT NULL PRIMARY KEY,
      ui varchar(96) NOT NULL,
      core varchar(96) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, `CREATE TABLE system_version_reservations (
      batch varchar(160) NOT NULL PRIMARY KEY,
      request_hash char(64) NOT NULL,
      build char(36) NOT NULL,
      ui varchar(96) DEFAULT NULL,
      core varchar(96) DEFAULT NULL,
      UNIQUE KEY system_build_id (build),
      UNIQUE KEY system_ui_version (ui),
      UNIQUE KEY system_core_version (core)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  }, {
    id: '2026-11-25.system-web-candidates',
    tables: [`CREATE TABLE system_web_candidates (
      build char(36) NOT NULL PRIMARY KEY,
      version varchar(96) NOT NULL UNIQUE,
      digest char(64) NOT NULL,
      state varchar(16) NOT NULL,
      files int unsigned NOT NULL,
      bytes int unsigned NOT NULL,
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      actor varchar(64) DEFAULT NULL,
      KEY system_web_state (state,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  }, {
    id: '2026-11-25.system-desktop-candidates',
    tables: [`CREATE TABLE system_desktop_candidates (
      build char(36) NOT NULL PRIMARY KEY, base char(36) DEFAULT NULL, kind varchar(8) NOT NULL,
      ui json NOT NULL, core json NOT NULL, notes varchar(1000) NOT NULL,
      state varchar(16) NOT NULL, actor varchar(64) DEFAULT NULL,
      created_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      KEY system_desktop_state (state,created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`],
  }],
  tables: [
    `CREATE TABLE user_desktop_appearance (
      user_id char(36) NOT NULL,
      wallpapers json NOT NULL,
      revision int unsigned NOT NULL DEFAULT '1',
      updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id),
      CONSTRAINT desktop_appearance_owner_fk FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    `CREATE TABLE user_desktop_layouts (
      user_id char(36) NOT NULL,
      device varchar(12) NOT NULL,
      app_ids json NOT NULL,
      revision int unsigned NOT NULL DEFAULT '1',
      updated_at datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (user_id,device),
      CONSTRAINT desktop_owner_fk FOREIGN KEY (user_id) REFERENCES app_users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  ],
}
