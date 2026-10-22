import type {
  BabyInput,
  BabyMeasurement,
  BabyRecordKind,
  BabyRole,
  BabyScope,
  BabyVisibility,
  CreativeTemplate,
  PlaybackSettings,
} from '@t-box/baby-diary-contracts'
import { EntitySchema } from 'typeorm'
import { babyCareEntities } from './care-entities.js'

export interface StoredBabyActor {
  generation: number
  releaseId: string
  active: boolean
  subject: string
  createdAt: Date
}
export const BabyActorEntity = new EntitySchema<StoredBabyActor>({
  name: 'BabyActor',
  tableName: 'baby_diary_actors',
  columns: {
    generation: { type: 'int' },
    releaseId: { type: 'varchar', name: 'release_id', length: 80 },
    active: { type: 'boolean' },
    subject: { type: 'char', length: 64, primary: true },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
})
export interface StoredBabyProfile {
  id: string
  name: string
  birthDate: string | null
  sex: BabyInput['sex']
  theme: NonNullable<BabyInput['theme']> | null
  timezone: string
  ownerSubject: string
  archived: boolean
  revision: number
  createdAt: Date
  updatedAt: Date
}
export const BabyProfileEntity = new EntitySchema<StoredBabyProfile>({
  name: 'BabyProfile',
  tableName: 'baby_diary_babies',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    name: { type: 'varchar', length: 40 },
    birthDate: { type: 'date', name: 'birth_date', nullable: true },
    sex: { type: 'varchar', length: 10 },
    theme: { type: 'varchar', length: 10, nullable: true },
    timezone: { type: 'varchar', length: 80 },
    ownerSubject: { type: 'char', length: 64, name: 'owner_subject' },
    archived: { type: 'boolean' },
    revision: { type: 'int' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
  },
  indices: [{ name: 'baby_owner', columns: ['ownerSubject'] }],
})
export interface StoredBabyMember {
  babyId: string
  subject: string
  displayName: string
  role: BabyRole
  scopes: BabyScope[]
  allowExport: boolean
  joinedAt: Date
}
export const BabyMemberEntity = new EntitySchema<StoredBabyMember>({
  name: 'BabyMember',
  tableName: 'baby_diary_members',
  columns: {
    babyId: { type: 'char', length: 36, name: 'baby_id', primary: true },
    subject: { type: 'char', length: 64, primary: true },
    displayName: { type: 'varchar', length: 40, name: 'display_name' },
    role: { type: 'varchar', length: 10 },
    scopes: { type: 'json' },
    allowExport: { type: 'boolean', name: 'allow_export' },
    joinedAt: { type: 'datetime', precision: 3, name: 'joined_at' },
  },
  indices: [{ name: 'baby_member_subject', columns: ['subject'] }],
})
export interface StoredBabyInvite {
  id: string
  babyId: string
  tokenHash: string
  role: Exclude<BabyRole, 'owner'>
  scopes: BabyScope[]
  allowExport: boolean
  maxUses: number
  uses: number
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}
export const BabyInviteEntity = new EntitySchema<StoredBabyInvite>({
  name: 'BabyInvite',
  tableName: 'baby_diary_invites',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    babyId: { type: 'char', length: 36, name: 'baby_id' },
    tokenHash: { type: 'char', length: 64, name: 'token_hash', select: false },
    role: { type: 'varchar', length: 10 },
    scopes: { type: 'json' },
    allowExport: { type: 'boolean', name: 'allow_export' },
    maxUses: { type: 'int', name: 'max_uses' },
    uses: { type: 'int' },
    expiresAt: { type: 'datetime', precision: 3, name: 'expires_at' },
    revokedAt: {
      type: 'datetime',
      precision: 3,
      name: 'revoked_at',
      nullable: true,
    },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
  indices: [
    { name: 'baby_invite_token', columns: ['tokenHash'], unique: true },
  ],
})
export interface StoredBabyRecord {
  id: string
  babyId: string
  kind: BabyRecordKind
  date: string
  title: string
  text: string
  tags: string[]
  assetIds: string[]
  visibility: BabyVisibility
  heightMm: number | null
  weightGrams: number | null
  headMm: number | null
  method: BabyMeasurement['method']
  author: string
  authorName: string
  revision: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
export const BabyRecordEntity = new EntitySchema<StoredBabyRecord>({
  name: 'BabyRecord',
  tableName: 'baby_diary_records',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    babyId: { type: 'char', length: 36, name: 'baby_id' },
    kind: { type: 'varchar', length: 20 },
    date: { type: 'date' },
    title: { type: 'varchar', length: 100 },
    text: { type: 'text' },
    tags: { type: 'json' },
    assetIds: { type: 'json', name: 'asset_ids' },
    visibility: { type: 'varchar', length: 10 },
    heightMm: { type: 'int', name: 'height_mm', nullable: true },
    weightGrams: { type: 'int', name: 'weight_grams', nullable: true },
    headMm: { type: 'int', name: 'head_mm', nullable: true },
    method: { type: 'varchar', length: 20 },
    author: { type: 'char', length: 64 },
    authorName: { type: 'varchar', length: 40, name: 'author_name' },
    revision: { type: 'int' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
    deletedAt: {
      type: 'datetime',
      precision: 3,
      name: 'deleted_at',
      nullable: true,
    },
  },
  indices: [
    {
      name: 'baby_record_timeline',
      columns: ['babyId', 'deletedAt', 'date', 'id'],
    },
  ],
})
export interface StoredBabyProject {
  id: string
  babyId: string
  title: string
  template: CreativeTemplate
  visibility: BabyVisibility
  settings: PlaybackSettings
  author: string
  revision: number
  frameCount: number
  createdAt: Date
  updatedAt: Date
  deletedAt: Date | null
}
export const BabyProjectEntity = new EntitySchema<StoredBabyProject>({
  name: 'BabyProject',
  tableName: 'baby_diary_projects',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    babyId: { type: 'char', length: 36, name: 'baby_id' },
    title: { type: 'varchar', length: 60 },
    template: { type: 'varchar', length: 30 },
    visibility: { type: 'varchar', length: 10 },
    settings: { type: 'json' },
    author: { type: 'char', length: 64 },
    revision: { type: 'int' },
    frameCount: { type: 'int', name: 'frame_count' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
    updatedAt: { type: 'datetime', precision: 3, name: 'updated_at' },
    deletedAt: {
      type: 'datetime',
      precision: 3,
      name: 'deleted_at',
      nullable: true,
    },
  },
  indices: [{ name: 'baby_project_list', columns: ['babyId', 'deletedAt'] }],
})
export interface StoredBabyFrame {
  id: string
  projectId: string
  assetId: string
  date: string
  caption: string
  position: number
  x: number
  y: number
  scale: number
  rotation: number
}
export const BabyFrameEntity = new EntitySchema<StoredBabyFrame>({
  name: 'BabyFrame',
  tableName: 'baby_diary_frames',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    projectId: { type: 'char', length: 36, name: 'project_id' },
    assetId: { type: 'char', length: 36, name: 'asset_id' },
    date: { type: 'date' },
    caption: { type: 'varchar', length: 200 },
    position: { type: 'int' },
    x: { type: 'double' },
    y: { type: 'double' },
    scale: { type: 'double' },
    rotation: { type: 'double' },
  },
  indices: [{ name: 'baby_frame_order', columns: ['projectId', 'position'] }],
})
export interface StoredBabyOperation {
  subject: string
  operationKey: string
  payloadHash: string
  response: unknown
  createdAt: Date
}
export const BabyOperationEntity = new EntitySchema<StoredBabyOperation>({
  name: 'BabyOperation',
  tableName: 'baby_diary_operations',
  columns: {
    subject: { type: 'char', length: 64, primary: true },
    operationKey: {
      type: 'char',
      length: 64,
      name: 'operation_key',
      primary: true,
    },
    payloadHash: { type: 'char', length: 64, name: 'payload_hash' },
    response: { type: 'json' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
})
export interface StoredBabyAudit {
  id: string
  babyId: string
  actor: string
  action: string
  targetId: string
  createdAt: Date
}
export const BabyAuditEntity = new EntitySchema<StoredBabyAudit>({
  name: 'BabyAudit',
  tableName: 'baby_diary_audit',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    babyId: { type: 'char', length: 36, name: 'baby_id' },
    actor: { type: 'char', length: 64 },
    action: { type: 'varchar', length: 50 },
    targetId: { type: 'varchar', length: 80, name: 'target_id' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at' },
  },
  indices: [{ name: 'baby_audit_time', columns: ['babyId', 'createdAt'] }],
})
export const babyDiaryEntities = [
  ...babyCareEntities,
  BabyActorEntity,
  BabyProfileEntity,
  BabyMemberEntity,
  BabyInviteEntity,
  BabyRecordEntity,
  BabyProjectEntity,
  BabyFrameEntity,
  BabyOperationEntity,
  BabyAuditEntity,
]
