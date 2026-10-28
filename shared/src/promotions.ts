export interface PromotionMetrics {
  registrations: number
  payingUsers: number
  paidAmount: string
  refundedAmount: string
  netAmount: string
}

export interface PromotionLink {
  id: string
  token: string
  name: string
  shareUrl: string
  posterPath: string
  thumbnailPath: string
  title: string
  description: string
}

export interface PromotionChannel extends PromotionLink, PromotionMetrics {
  descriptionNote: string
  enabled: boolean
  revision: number
  createdAt: string
}

export interface PromotionChannelDraft {
  name: string
  descriptionNote: string
  enabled: boolean
  revision?: number
}
