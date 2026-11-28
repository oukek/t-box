import type { OptimizationJob, ProjectPrompt } from '@t-box/shop-tools-contracts'
import { EntitySchema } from 'typeorm'

const id = { type: 'char' as const, length: 64 }
const time = { type: 'varchar' as const, length: 24 }
export const PromptEntity = new EntitySchema<ProjectPrompt & { project: string }>({ name: 'ShopProjectPrompt', tableName: 'shop_tools_project_prompts', columns: { project: { ...id, primary: true }, language: { type: 'varchar', length: 50 }, prompt: { type: 'text' }, revision: { type: Number } } })
export const OptimizationEntity = new EntitySchema<OptimizationJob>({ name: 'ShopOptimization', tableName: 'shop_tools_optimizations', columns: { id: { ...id, primary: true }, project: id, subject: id, product: id, snapshot: { type: 'json' }, results: { type: 'json' }, status: { type: 'varchar', length: 12 }, lease: { type: 'varchar', length: 80 }, updatedAt: { ...time, name: 'updated_at' }, createdAt: { ...time, name: 'created_at' }, appliedVersion: { ...id, name: 'applied_version', nullable: true } } })
export const optimizationExtension = { id: '2026-11-28.shop-tools-optimizations', tables: [
  `CREATE TABLE shop_tools_project_prompts (project char(64) PRIMARY KEY, language varchar(50) NOT NULL, prompt text NOT NULL, revision int NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE shop_tools_optimizations (id char(64) PRIMARY KEY, project char(64) NOT NULL, subject char(64) NOT NULL, product char(64) NOT NULL, snapshot json NOT NULL, results json NOT NULL, status varchar(12) NOT NULL, lease varchar(80) NOT NULL, updated_at varchar(24) NOT NULL, created_at varchar(24) NOT NULL, applied_version char(64) DEFAULT NULL, KEY shop_opt_project(project,product,created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
] }
