import { EntitySchema } from 'typeorm'

export interface PromotionSourceRow {
  id: string
  token: string
  kind: 'channel' | 'user'
  ownerUserId: string | null
  name: string
  descriptionNote: string
  enabled: boolean
  revision: number
  createdAt: Date
}

export const PromotionSourceEntity = new EntitySchema<PromotionSourceRow>({
  name: 'PromotionSource',
  tableName: 'promotion_sources',
  columns: {
    id: { type: 'char', length: 36, primary: true },
    token: { type: 'char', length: 32, unique: true },
    kind: { type: 'enum', enum: ['channel', 'user'] },
    ownerUserId: { type: 'char', length: 36, name: 'owner_user_id', nullable: true, unique: true },
    name: { type: 'varchar', length: 80 },
    descriptionNote: { type: 'varchar', length: 300, name: 'description_note', default: '' },
    enabled: { type: Boolean, default: true },
    revision: { type: Number, default: 1 },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at', createDate: true },
  },
})

export interface PromotionRegistrationRow {
  userId: string
  sourceId: string
  createdAt: Date
}

export const PromotionRegistrationEntity = new EntitySchema<PromotionRegistrationRow>({
  name: 'PromotionRegistration',
  tableName: 'promotion_registrations',
  columns: {
    userId: { type: 'char', length: 36, name: 'user_id', primary: true },
    sourceId: { type: 'char', length: 36, name: 'source_id' },
    createdAt: { type: 'datetime', precision: 3, name: 'created_at', createDate: true },
  },
})

export interface PromotionFlowRow {
  flowId: string
  sourceId: string
}

export const PromotionFlowEntity = new EntitySchema<PromotionFlowRow>({
  name: 'PromotionFlow',
  tableName: 'promotion_login_flows',
  columns: {
    flowId: { type: 'char', length: 36, name: 'flow_id', primary: true },
    sourceId: { type: 'char', length: 36, name: 'source_id' },
  },
})

export const promotionEntities = [PromotionSourceEntity, PromotionRegistrationEntity, PromotionFlowEntity]
