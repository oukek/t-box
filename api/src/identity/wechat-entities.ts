import type { EntitySchemaColumnOptions } from 'typeorm'
import { EntitySchema } from 'typeorm'

const id: EntitySchemaColumnOptions = { type: 'char', length: 36, primary: true }
const date: EntitySchemaColumnOptions = { type: 'datetime', precision: 3 }

export interface WechatAccountRow {
  id: number
  revision: number
  enabled: boolean
  appId: string
  frontendUrl: string
  appSecretCipher: string
  updatedBy: string | null
  updatedAt: Date
}
export const WechatAccountEntity = new EntitySchema<WechatAccountRow>({
  name: 'WechatAccount',
  tableName: 'wechat_account_settings',
  columns: {
    id: { type: 'tinyint', primary: true },
    revision: { type: Number },
    enabled: { type: Boolean },
    appId: { type: 'varchar', length: 64, name: 'app_id' },
    frontendUrl: { type: 'varchar', length: 1024, name: 'frontend_url' },
    appSecretCipher: { type: 'text', name: 'app_secret_cipher', select: false },
    updatedBy: { type: 'char', length: 36, name: 'updated_by', nullable: true },
    updatedAt: { ...date, name: 'updated_at' },
  },
})

export interface WechatIdentityRow {
  appId: string
  openidHash: string
  userId: string
  openidCipher: string
  avatarUrl: string
  updatedAt: Date
}
export const WechatIdentityEntity = new EntitySchema<WechatIdentityRow>({
  name: 'WechatIdentity',
  tableName: 'wechat_identities',
  columns: {
    appId: { type: 'varchar', length: 64, name: 'app_id', primary: true },
    openidHash: { type: 'char', length: 64, name: 'openid_hash', primary: true },
    userId: { type: 'char', length: 36, name: 'user_id' },
    openidCipher: { type: 'text', name: 'openid_cipher', select: false },
    avatarUrl: { type: 'varchar', length: 2048, name: 'avatar_url' },
    updatedAt: { ...date, name: 'updated_at' },
  },
})

export interface WechatFlowRow {
  id: string
  kind: 'login' | 'qr' | 'scan'
  secretHash: string
  stateHash: string | null
  appId: string
  parentId: string | null
  device: string
  status: 'pending' | 'exchanging' | 'scanned' | 'complete' | 'cancelled' | 'failed'
  userId: string | null
  sessionCipher: string | null
  sessionHash: string | null
  checkoutTokenHash: string | null
  expiresAt: Date
  createdAt: Date
}
export const WechatFlowEntity = new EntitySchema<WechatFlowRow>({
  name: 'WechatLoginFlow',
  tableName: 'wechat_login_flows',
  columns: {
    id,
    kind: { type: 'enum', enum: ['login', 'qr', 'scan'] },
    secretHash: { type: 'char', length: 64, name: 'secret_hash', select: false },
    stateHash: { type: 'char', length: 64, name: 'state_hash', nullable: true, select: false },
    appId: { type: 'varchar', length: 64, name: 'app_id' },
    parentId: { type: 'char', length: 36, name: 'parent_id', nullable: true },
    device: { type: 'varchar', length: 120 },
    status: { type: 'enum', enum: ['pending', 'exchanging', 'scanned', 'complete', 'cancelled', 'failed'] },
    userId: { type: 'char', length: 36, name: 'user_id', nullable: true },
    sessionCipher: { type: 'text', name: 'session_cipher', nullable: true, select: false },
    sessionHash: { type: 'char', length: 64, name: 'session_hash', nullable: true, select: false },
    checkoutTokenHash: { type: 'char', length: 64, name: 'checkout_token_hash', nullable: true, select: false },
    expiresAt: { ...date, name: 'expires_at' },
    createdAt: { ...date, name: 'created_at' },
  },
})
export interface WechatAuthorizationRow {
  flowId: string
  scope: 'snsapi_base' | 'snsapi_userinfo'
  openidHash: string | null
}
export const WechatAuthorizationEntity = new EntitySchema<WechatAuthorizationRow>({
  name: 'WechatLoginAuthorization',
  tableName: 'wechat_login_authorizations',
  columns: {
    flowId: { type: 'char', length: 36, name: 'flow_id', primary: true },
    scope: { type: 'enum', enum: ['snsapi_base', 'snsapi_userinfo'] },
    openidHash: { type: 'char', length: 64, name: 'openid_hash', nullable: true },
  },
})
export const wechatIdentityEntities = [WechatAccountEntity, WechatIdentityEntity, WechatFlowEntity, WechatAuthorizationEntity]
