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
    {
      id: '2026-11-22.shop-tools-projects',
      tables: [
        `CREATE TABLE shop_tools_projects (
  id char(64) PRIMARY KEY, name varchar(80) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE shop_tools_members (
  project char(64) NOT NULL, subject char(64) NOT NULL, name varchar(80) NOT NULL,
  role varchar(10) NOT NULL, PRIMARY KEY(project, subject), KEY shop_members_subject(subject)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
        `CREATE TABLE shop_tools_invites (
  id char(64) PRIMARY KEY, project char(64) NOT NULL, role varchar(10) NOT NULL,
  expires_at datetime(3) NOT NULL, remaining int NOT NULL, KEY shop_invites_project(project)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
      ],
    },
    {
      id: '2026-11-22.shop-tools-creations',
      tables: [`CREATE TABLE shop_tools_creations (
  id char(64) PRIMARY KEY, subject char(64) NOT NULL, project char(64) NOT NULL,
  created_at varchar(24) NOT NULL, status varchar(12) NOT NULL, input json NOT NULL,
  output json NOT NULL, errors json NOT NULL, KEY shop_creations_history(project,subject,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`],
    },
  ],
}
