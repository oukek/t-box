import { babyDiaryEntities } from '@t-box/baby-diary-server'
import {
  CalendarEventEntity,
  CalendarExceptionEntity,
} from '@t-box/calendar-server/entity'
import {
  HolidayAuditEntity,
  HolidaySettingsEntity,
  HolidayYearEntity,
} from '@t-box/calendar-server/holiday-entity'
import { ledgerDomainEntities } from '@t-box/ledger-server'
import { BillEntity, CategoryEntity } from '@t-box/ledger-server/entities'
import { ledgerRecordEntities } from '@t-box/ledger-server/persistence/index'
import { ApplicationOperationEntity } from '@t-box/server-foundation/persistence/entities'
import { PrivateFileEntity, PrivateFileQuotaEntity } from '@t-box/server-foundation/persistence/private-media'
import { ResourceEntity } from '@t-box/server-foundation/persistence/resource-entity'
import { TimerEntity } from '@t-box/time-server/entity'
import { EntitySchema } from 'typeorm'
import {
  DesktopAppearanceEntity,
  DesktopLayoutEntity,
} from '../desktop/entity.js'
import { RechargeSettingsEntity } from '../payments/recharge.js'
import { SupportSettingsEntity } from '../support/entity.js'
import { platformEntities } from './platform-entities.js'
import { platformRecordEntities } from './records/index.js'

export {
  BillEntity,
  CategoryEntity,
  type StoredBill,
} from '@t-box/ledger-server/entities'

const id = { type: 'char' as const, length: 36, primary: true }
const enabled = { type: Boolean, default: true }
const createdAt = {
  type: 'datetime' as const,
  precision: 3,
  name: 'created_at',
  default: () => 'CURRENT_TIMESTAMP(3)',
}
export interface AdminUserRow {
  id: string
  username: string
  passwordHash: string
  enabled: boolean
  failedAttempts: number
  lockedUntil: string | null
  createdAt: string
}
export const AdminUserEntity = new EntitySchema<AdminUserRow>({
  name: 'AdminUser',
  tableName: 'admin_users',
  columns: {
    id,
    username: { type: 'varchar', length: 64, unique: true },
    passwordHash: {
      type: 'varchar',
      name: 'password_hash',
      length: 200,
      select: false,
    },
    enabled,
    failedAttempts: { type: Number, name: 'failed_attempts', default: 0 },
    lockedUntil: {
      type: 'datetime',
      precision: 3,
      name: 'locked_until',
      nullable: true,
    },
    createdAt,
  },
})
export interface AdminSessionRow {
  tokenHash: string
  adminId: string
  expiresAt: string
}
export const AdminSessionEntity = new EntitySchema<AdminSessionRow>({
  name: 'AdminSession',
  tableName: 'admin_sessions',
  columns: {
    tokenHash: { type: 'char', length: 64, name: 'token_hash', primary: true },
    adminId: { type: 'char', length: 36, name: 'admin_id' },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
  },
  indices: [{ columns: ['expiresAt'] }],
  foreignKeys: [
    {
      target: 'AdminUser',
      columnNames: ['adminId'],
      referencedColumnNames: ['id'],
      onDelete: 'CASCADE',
    },
  ],
})
export interface ProviderRow {
  maxConcurrency: number
  id: string
  name: string
  baseUrl: string
  keyCipher: string
  enabled: boolean
  revision: number
  createdAt: string
}
export const ProviderEntity = new EntitySchema<ProviderRow>({
  name: 'AIProvider',
  tableName: 'ai_providers',
  columns: {
    maxConcurrency: {
      type: Number,
      name: 'max_concurrency',
      unsigned: true,
      default: 0,
    },
    id,
    name: { type: 'varchar', length: 80 },
    baseUrl: { type: 'varchar', length: 500, name: 'base_url' },
    keyCipher: { type: 'text', name: 'key_cipher', select: false },
    enabled,
    revision: { type: Number, default: 1 },
    createdAt,
  },
})
export interface ModelRow {
  maxConcurrency: number
  invocationMode: import('@t-box/shared').ModelInvocationMode
  contextPolicy: import('@t-box/shared').ContextPolicy | null
  purpose: 'conversation' | 'image'
  supportsVision: boolean
  supportsReasoning: boolean
  inputPrice: string
  outputPrice: string
  imagePrice: string
  id: string
  providerId: string
  modelId: string
  name: string
  enabled: boolean
}
export const ModelEntity = new EntitySchema<ModelRow>({
  name: 'AIModel',
  tableName: 'ai_models',
  columns: {
    maxConcurrency: {
      type: Number,
      name: 'max_concurrency',
      unsigned: true,
      default: 4,
    },
    invocationMode: {
      type: 'enum',
      enum: ['responses', 'chat_completions', 'images'],
      name: 'invocation_mode',
      default: 'responses',
    },
    contextPolicy: { type: 'json', name: 'context_policy', nullable: true },
    id,
    purpose: {
      type: 'enum',
      enum: ['conversation', 'image'],
      default: 'conversation',
    },
    supportsVision: { type: Boolean, name: 'supports_vision', default: false },
    inputPrice: {
      type: 'decimal',
      precision: 18,
      scale: 6,
      name: 'input_price',
      default: '0',
    },
    outputPrice: {
      type: 'decimal',
      precision: 18,
      scale: 6,
      name: 'output_price',
      default: '0',
    },
    imagePrice: {
      type: 'decimal',
      precision: 18,
      scale: 6,
      name: 'image_price',
      default: '0',
    },
    supportsReasoning: {
      type: Boolean,
      name: 'supports_reasoning',
      default: false,
    },
    providerId: { type: 'char', length: 36, name: 'provider_id' },
    modelId: { type: 'varchar', length: 200, name: 'model_id' },
    name: { type: 'varchar', length: 80 },
    enabled,
  },
  uniques: [{ columns: ['providerId', 'modelId'] }],
  foreignKeys: [
    {
      target: 'AIProvider',
      columnNames: ['providerId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
})
export const SettingsEntity = new EntitySchema<{
  id: number
  modelId: string | null
  imageModelId: string | null
}>({
  name: 'AISettings',
  tableName: 'ai_settings',
  columns: {
    id: { type: 'tinyint', primary: true },
    modelId: { type: 'char', length: 36, name: 'model_id', nullable: true },
    imageModelId: {
      type: 'char',
      length: 36,
      name: 'image_model_id',
      nullable: true,
    },
  },
  checks: [{ name: 'single_ai_settings', expression: 'id = 1' }],
  foreignKeys: [
    {
      target: 'AIModel',
      columnNames: ['modelId'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
})
export const entities = [
  ...babyDiaryEntities,
  PrivateFileEntity,
  PrivateFileQuotaEntity,
  ...platformRecordEntities,
  ...ledgerRecordEntities,
  ResourceEntity,
  ...platformEntities,
  ...ledgerDomainEntities,
  BillEntity,
  CategoryEntity,
  AdminUserEntity,
  AdminSessionEntity,
  ProviderEntity,
  ModelEntity,
  SettingsEntity,
  SupportSettingsEntity,
  RechargeSettingsEntity,
  HolidayYearEntity,
  HolidaySettingsEntity,
  HolidayAuditEntity,
  CalendarEventEntity,
  CalendarExceptionEntity,
  TimerEntity,
  ApplicationOperationEntity,
  DesktopLayoutEntity,
  DesktopAppearanceEntity,
]
