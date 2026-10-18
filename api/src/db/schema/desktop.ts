import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'

export const desktopSchema: DatabaseSchema = {
  id: 'desktop',
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
