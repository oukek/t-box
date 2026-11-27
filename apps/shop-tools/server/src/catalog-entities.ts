import type { CatalogContent, CollectedProduct, CreativeTemplate } from '@t-box/shop-tools-contracts'
import { EntitySchema } from 'typeorm'

const id = { type: 'char' as const, length: 64 }
const time = { type: 'varchar' as const, length: 24, name: 'created_at' }
export const CollectionEntity = new EntitySchema<{ id: string, subject: string, data: CollectedProduct, createdAt: string }>({ name: 'ShopCollection', tableName: 'shop_tools_collection', columns: { id: { ...id, primary: true }, subject: id, data: { type: 'json' }, createdAt: time } })
export const CatalogEntity = new EntitySchema<{ id: string, project: string, source: string, title: string, modified: boolean, createdAt: string }>({ name: 'ShopCatalog', tableName: 'shop_tools_catalog', columns: { id: { ...id, primary: true }, project: id, source: id, title: { type: 'varchar', length: 1000 }, modified: { type: Boolean }, createdAt: time } })
export const VersionEntity = new EntitySchema<{ id: string, product: string, name: string, revision: number, content: CatalogContent, createdAt: string }>({ name: 'ShopCatalogVersion', tableName: 'shop_tools_catalog_versions', columns: { id: { ...id, primary: true }, product: id, name: { type: 'varchar', length: 80 }, revision: { type: Number }, content: { type: 'json' }, createdAt: time } })
export const ProjectSiteEntity = new EntitySchema<{ project: string, site: string }>({ name: 'ShopProjectSite', tableName: 'shop_tools_project_sites', columns: { project: { ...id, primary: true }, site: { type: 'varchar', length: 8 } } })
export const AssistantSettingsEntity = new EntitySchema<{ subject: string, templates: CreativeTemplate[] }>({ name: 'ShopAssistantSettings', tableName: 'shop_tools_assistant_settings', columns: { subject: { ...id, primary: true }, templates: { type: 'json' } } })
export const catalogEntities = [CollectionEntity, CatalogEntity, VersionEntity, ProjectSiteEntity, AssistantSettingsEntity]
export const catalogExtension = { id: '2026-11-27.shop-tools-catalog', tables: [
  `CREATE TABLE shop_tools_assistant_settings (subject char(64) PRIMARY KEY, templates json NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE shop_tools_collection (id char(64) PRIMARY KEY, subject char(64) NOT NULL, data json NOT NULL, created_at varchar(24) NOT NULL, KEY collection_owner(subject,created_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE shop_tools_catalog (id char(64) PRIMARY KEY, project char(64) NOT NULL, source char(64) NOT NULL, title varchar(1000) NOT NULL, modified boolean NOT NULL, created_at varchar(24) NOT NULL, UNIQUE KEY catalog_claim(project,source), KEY catalog_list(project,created_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE shop_tools_catalog_versions (id char(64) PRIMARY KEY, product char(64) NOT NULL, name varchar(80) NOT NULL, revision int NOT NULL, content json NOT NULL, created_at varchar(24) NOT NULL, KEY catalog_versions(product,created_at,id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE shop_tools_project_sites (project char(64) PRIMARY KEY, site varchar(8) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] }
