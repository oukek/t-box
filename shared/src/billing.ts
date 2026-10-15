export interface ModelPrices {
  inputPrice: string // CNY / 1M tokens
  outputPrice: string
  imagePrice: string // CNY / image (generation and editing)
}
export type BillingMode = 'charge' | 'record_only'
export interface Wallet {
  currency: 'CNY'
  balance: string
  reserved: string
  available: string
  mode: BillingMode
}
export interface UsageRecord {
  id: string
  kind: 'conversation' | 'image'
  status: 'reserved' | 'settled' | 'review' | 'released'
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
  createdAt: string
}
export interface WalletEntry {
  id: string
  kind: 'usage' | 'recharge' | 'grant' | 'refund'
  amount: string
  balance: string
  createdAt: string
}
export interface BillingUser extends Wallet {
  id: string
  username: string
  nickname: string
}
export interface PaymentOrder {
  id: string
  amount: string
  bonusAmount: string
  creditedAmount: string
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
