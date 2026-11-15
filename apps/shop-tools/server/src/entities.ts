import type {
  Config,
  Product,
  WorkspaceMetadata,
  WorkspaceState,
} from '@t-box/shop-tools-contracts'
import { EntitySchema } from 'typeorm'

export interface StoredWorkspace {
  subject: string
  generation: number
  releaseId: string
  active: boolean
  revision: number
  metadata: WorkspaceMetadata | null
  config: Config | null
  history: Pick<WorkspaceState, 'detail' | 'comparison'> | null
  updatedAt: Date
}
export const ShopWorkspaceEntity = new EntitySchema<StoredWorkspace>({
  name: 'ShopToolsWorkspace',
  tableName: 'shop_tools_workspaces',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    generation: { type: 'int' },
    releaseId: { type: 'varchar', name: 'release_id', length: 80 },
    active: { type: 'boolean' },
    revision: { type: 'int' },
    metadata: { type: 'json', nullable: true },
    config: { type: 'json', nullable: true },
    history: { type: 'json', nullable: true },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
  },
})
export interface StoredProduct {
  subject: string
  sheetId: string
  id: string
  position: number
  data: Product
}
export const ShopProductEntity = new EntitySchema<StoredProduct>({
  name: 'ShopToolsProduct',
  tableName: 'shop_tools_products',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    sheetId: { type: 'varchar', length: 80, name: 'sheet_id', primary: true },
    id: { type: 'varchar', length: 80, primary: true },
    position: { type: 'int' },
    data: { type: 'json' },
  },
  indices: [
    {
      name: 'shop_product_order',
      columns: ['subject', 'sheetId', 'position', 'id'],
    },
  ],
})
export interface StoredOperation {
  subject: string
  key: string
  hash: string
  response: Record<string, unknown>
  createdAt: Date
}
export const ShopOperationEntity = new EntitySchema<StoredOperation>({
  name: 'ShopToolsOperation',
  tableName: 'shop_tools_operations',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    key: { type: 'char', length: 64, primary: true },
    hash: { type: 'char', length: 64 },
    response: { type: 'json' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
})
export const shopToolsEntities = [
  ShopWorkspaceEntity,
  ShopProductEntity,
  ShopOperationEntity,
]
