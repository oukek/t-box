import type {
  BillingMode,
  QuotaTariff,
  ResourcePackageDraft,
} from '@t-box/shared'
import { utcSqlDateTime } from '@t-box/server-foundation/persistence/columns'
import { EntitySchema } from 'typeorm'

const id = { type: 'char' as const, length: 36, primary: true }
const uuid = { type: 'char' as const, length: 36 }
const time = {
  type: 'datetime' as const,
  precision: 3,
  transformer: utcSqlDateTime,
}
const atoms = { type: 'bigint' as const, default: '0' }
export interface ProductRow {
  id: string
  code: string
  draft: ResourcePackageDraft
  currentVersion: number
  revision: number
}
export const QuotaProductEntity = new EntitySchema<ProductRow>({
  name: 'QuotaProduct',
  tableName: 'ai_quota_products',
  columns: {
    id,
    code: { type: 'varchar', length: 40, unique: true },
    draft: { type: 'json' },
    currentVersion: { type: 'int', default: 0 },
    revision: { type: 'int', default: 1 },
  },
})
export interface ProductVersionRow {
  id: string
  productId: string
  version: number
  configuration: ResourcePackageDraft
  createdAt: string
}
export const QuotaProductVersionEntity = new EntitySchema<ProductVersionRow>({
  name: 'QuotaProductVersion',
  tableName: 'ai_quota_product_versions',
  columns: {
    id,
    productId: uuid,
    version: { type: 'int' },
    configuration: { type: 'json' },
    createdAt: time,
  },
  indices: [{ columns: ['productId', 'version'], unique: true }],
  foreignKeys: [
    {
      target: 'QuotaProduct',
      columnNames: ['productId'],
      referencedColumnNames: ['id'],
    },
  ],
})
export interface TariffRow {
  version: number
  configuration: QuotaTariff
  administratorId: string | null
  createdAt: string
}
export const QuotaTariffEntity = new EntitySchema<TariffRow>({
  name: 'QuotaTariff',
  tableName: 'ai_quota_tariffs',
  columns: {
    version: { type: 'int', primary: true },
    configuration: { type: 'json' },
    administratorId: { ...uuid, nullable: true },
    createdAt: time,
  },
})
export interface AccountRow {
  userId: string
  mode: BillingMode
  revision: number
}
export const QuotaAccountEntity = new EntitySchema<AccountRow>({
  name: 'QuotaAccount',
  tableName: 'ai_quota_accounts',
  columns: {
    userId: { ...id },
    mode: { type: 'enum', enum: ['charge', 'record_only'], default: 'charge' },
    revision: { type: 'int', default: 1 },
  },
  foreignKeys: [
    {
      target: 'AppUser',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
})
export interface LotRow {
  id: string
  userId: string
  sourceKey: string
  source: 'purchase' | 'grant' | 'compensation'
  name: string
  total: string
  available: string
  reserved: string
  consumed: string
  expired: string
  revoked: string
  expiresAt: string
  createdAt: string
  orderId: string | null
  packageVersionId: string | null
}
export const QuotaLotEntity = new EntitySchema<LotRow>({
  name: 'QuotaLot',
  tableName: 'ai_quota_lots',
  columns: {
    id,
    userId: uuid,
    sourceKey: { type: 'varchar', length: 150, unique: true },
    source: { type: 'varchar', length: 20 },
    name: { type: 'varchar', length: 80 },
    total: atoms,
    available: atoms,
    reserved: atoms,
    consumed: atoms,
    expired: atoms,
    revoked: atoms,
    expiresAt: time,
    createdAt: time,
    orderId: { ...uuid, nullable: true },
    packageVersionId: { ...uuid, nullable: true },
  },
  indices: [
    { columns: ['userId', 'expiresAt', 'createdAt'] },
    { columns: ['orderId'] },
  ],
  foreignKeys: [
    {
      target: 'AppUser',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
})
export interface AllocationRow {
  id: string
  reference: string
  userId: string
  lotId: string
  allocated: string
  reserved: string
  consumed: string
  released: string
  returned: string
  createdAt: string
}
export const QuotaAllocationEntity = new EntitySchema<AllocationRow>({
  name: 'QuotaAllocation',
  tableName: 'ai_quota_allocations',
  columns: {
    id,
    reference: { type: 'varchar', length: 100 },
    userId: uuid,
    lotId: uuid,
    allocated: atoms,
    reserved: atoms,
    consumed: atoms,
    released: atoms,
    returned: atoms,
    createdAt: time,
  },
  indices: [
    { columns: ['reference', 'lotId'], unique: true },
    { columns: ['userId', 'reference'] },
  ],
  foreignKeys: [
    {
      target: 'QuotaLot',
      columnNames: ['lotId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
})
export interface QuotaEntryRow {
  id: string
  userId: string
  lotId: string | null
  reference: string
  kind:
    | 'purchase' |
    'grant' |
    'reserve' |
    'release' |
    'consume' |
    'reverse' |
    'expire' |
    'revoke'
  amount: string
  reason: string
  createdAt: string
}
export const QuotaEntryEntity = new EntitySchema<QuotaEntryRow>({
  name: 'QuotaEntry',
  tableName: 'ai_quota_entries',
  columns: {
    id,
    userId: uuid,
    lotId: { ...uuid, nullable: true },
    reference: { type: 'varchar', length: 220, unique: true },
    kind: { type: 'varchar', length: 20 },
    amount: { type: 'bigint' },
    reason: { type: 'varchar', length: 200 },
    createdAt: time,
  },
  indices: [{ columns: ['userId', 'createdAt'] }],
  foreignKeys: [
    {
      target: 'AppUser',
      columnNames: ['userId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
})
export const quotaEntities = [
  QuotaProductEntity,
  QuotaProductVersionEntity,
  QuotaTariffEntity,
  QuotaAccountEntity,
  QuotaLotEntity,
  QuotaAllocationEntity,
  QuotaEntryEntity,
]
