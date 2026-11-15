import type { DatabaseSchema } from '@t-box/server-foundation/persistence/schema'
// Added as an extension of the platform applications schema, preserving its frozen baseline.
export const shopToolsSchema: DatabaseSchema = {
  id: 'shop-tools',
  tables: [],
  extensions: [
    {
      id: '2026-11-15.shop-tools-workspaces',
      tables: [
        `CREATE TABLE shop_tools_workspaces (
  subject char(64) NOT NULL,
  generation int NOT NULL,
  release_id varchar(80) NOT NULL,
  active boolean NOT NULL,
  revision int NOT NULL,
  metadata json DEFAULT NULL,
  config json DEFAULT NULL,
  history json DEFAULT NULL,
  updated_at datetime(3) NOT NULL,
  PRIMARY KEY (subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE shop_tools_products (
  subject char(64) NOT NULL,
  sheet_id varchar(80) NOT NULL,
  id varchar(80) NOT NULL,
  position int NOT NULL,
  data json NOT NULL,
  PRIMARY KEY (subject,sheet_id,id),
  KEY shop_product_order (subject,sheet_id,position,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
        `CREATE TABLE shop_tools_operations (
  subject char(64) NOT NULL,
  \`key\` char(64) NOT NULL,
  hash char(64) NOT NULL,
  response json NOT NULL,
  created_at datetime(3) NOT NULL,
  PRIMARY KEY (subject,\`key\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      ],
    },
  ],
}
