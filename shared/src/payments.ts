export type WechatPaymentMode = 'native' | 'h5' | 'jsapi' | 'app'
export interface WechatJsSdkConfiguration {
  appId: string
  timestamp: number
  nonceStr: string
  signature: string
}
export interface WechatCheckoutLink {
  url: string
  expiresAt: string
}
export type WechatCheckoutStage = 'waiting' | 'scanned' | 'confirming' | 'paying' | 'cancelled' | 'expired' | 'paid' | 'closed'
export interface WechatCheckoutState {
  order: import('./billing.js').PaymentOrder
  stage: WechatCheckoutStage
  expiresAt?: string
}
export interface WechatCheckoutPreview {
  order: import('./billing.js').PaymentOrder
  recipient: Pick<import('./identity.js').AppUser, 'id' | 'nickname' | 'avatarUrl'>
  sameAccount: boolean
  payerUnavailable: boolean
}
export interface WechatPaymentConfiguration {
  id?: string
  enabled: boolean
  appId: string // Service account AppID for web payments
  mobileAppId: string // WeChat Open Platform mobile application
  app: boolean
  merchantId: string
  merchantSerial: string
  platformSerial: string
  platformPublicKey: string
  apiBaseUrl: string
  frontendUrl: string
  description: string
  native: boolean
  h5: boolean
  jsapi: boolean
  hasPrivateKey?: boolean
  hasApiV3Key?: boolean
  hasAppSecret?: boolean
}
export interface WechatPaymentSecrets {
  privateKey?: string
  apiV3Key?: string
  appSecret?: string
}
