export interface AppUser {
  id: string
  username: string
  nickname: string
  avatarUrl?: string
  createdAt: string
}

export interface WechatLoginConfiguration {
  enabled: boolean
  appId: string
  frontendUrl: string
  hasAppSecret: boolean
  revision: number
}

export interface WechatLoginFlow {
  id: string
  kind: 'login' | 'qr' | 'scan'
  state?: string
  authorizationUrl?: string
  qrUrl?: string
  expiresAt: string
}

export interface WechatLoginResult {
  status: 'pending' | 'exchanging' | 'scanned' | 'complete' | 'cancelled' | 'failed' | 'expired'
  kind: WechatLoginFlow['kind']
  user?: AppUser
  session?: UserSession
  device?: string
}
export interface UserSession {
  token: string
  user: AppUser
}
