export interface AccountSession {
  id: string
  current: boolean
  device: string
  createdAt: string
  lastSeenAt: string | null
  expiresAt: string
}
export interface RecoveryCodeStatus {
  remaining: number
  generatedAt: string | null
}
