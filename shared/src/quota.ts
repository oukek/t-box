/** Service credits are not cash. One credit has 10,000 indivisible accounting atoms. */
export const QUOTA_SCALE = 10000
export const IMAGE_TIERS = ['1k', '2k', '4k'] as const
export type ImageTier = (typeof IMAGE_TIERS)[number]
export interface ResourcePackageDraft {
  code: string
  name: string
  price: string
  quota: string
  bonusQuota: string
  validDays: number
  description: string
  sort: number
  enabled: boolean
}
export interface ResourcePackage extends ResourcePackageDraft {
  id: string
  version: number
  revision: number
  publishedAt: string | null
}
export interface AdminResourcePackage {
  id: string
  revision: number
  draft: ResourcePackageDraft
  published: ResourcePackage | null
}
export interface QuotaTariff {
  version: number
  enabled: boolean
  inputPerMillion: string
  outputPerMillion: string
  cachedInputPerMillion: string
  images: Record<ImageTier, string>
  edits: Record<ImageTier, string>
  taskLimit: string
  imageLimit: number
  publishedAt: string
}
export interface QuotaLot {
  id: string
  name: string
  source: 'purchase' | 'grant' | 'compensation'
  total: string
  available: string
  reserved: string
  consumed: string
  expired: string
  revoked: string
  expiresAt: string
  createdAt: string
  orderId: string | null
}
export interface QuotaAllocation {
  lotId: string
  name: string
  reserved: string
  consumed: string
  returned: string
}
export interface QuotaUsageBudget {
  inputTokens?: number
  outputTokens?: number
  images?: number
  tier?: ImageTier
  editing?: boolean
}
