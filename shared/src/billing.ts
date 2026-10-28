export interface ModelPrices {
  costMultiplier?: string // upstream procurement multiplier; never a public tariff
  inputPrice: string // CNY / 1M tokens
  outputPrice: string
  imagePrice: string // CNY / image (generation and editing)
}
export type BillingMode = 'charge' | 'record_only'
export interface Wallet {
  currency: 'QUOTA'
  revision: number
  balance: string
  reserved: string
  available: string
  mode: BillingMode
}
export interface UsageRecord {
  id: string
  kind: 'conversation' | 'image'
  status: 'reserved' | 'settled' | 'review' | 'released' | 'reversed'
  fee: string
  charged: string
  mode: BillingMode
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  messageId?: string | null
  agentId?: string | null
  purpose?: import('./agent-workflow.js').ModelCallPurpose
  images: number | null
  taskId: string | null
  allocations?: import('./quota.js').QuotaAllocation[]
  imageTier?: import('./quota.js').ImageTier
  createdAt: string
}
export interface WalletEntry {
  id: string
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
  lotId: string | null
  createdAt: string
}
export interface BillingUser extends Wallet {
  id: string
  username: string
  nickname: string
  avatarUrl?: string
}
export interface PaymentOrder {
  id: string
  amount: string
  packageId: string
  packageVersion: number
  packageName: string
  quota: string
  bonusQuota: string
  validDays: number
  currency: 'CNY'
  status: 'pending' | 'paid' | 'closed'
  createdAt: string
  expiresAt: string
  paidAt: string | null
}
export interface PaymentCapabilities {
  enabled: boolean
  channel: 'wechat'
  mobileAppId?: string
  modes?: import('./payments.js').WechatPaymentMode[]
}
export type PaymentIntent =
  | {
    type: 'jsapi'
    parameters: {
      appId: string
      timeStamp: string
      nonceStr: string
      package: string
      signType: 'RSA'
      paySign: string
    }
  } |
  { type: 'qr', codeUrl: string } |
  { type: 'redirect', url: string } |
  { type: 'app', parameters: WechatAppPaymentParameters }

export interface AdminPaymentOrder extends PaymentOrder {
  userId: string
  username: string
  nickname: string
}

/** API v3 APP secondary signature; no merchant credentials cross this boundary. */
export interface WechatAppPaymentParameters {
  appId: string
  partnerId: string
  prepayId: string
  packageValue: 'Sign=WXPay'
  nonceStr: string
  timeStamp: string
  sign: string
}
