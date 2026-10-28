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

export interface PromotionImage {
  id: string
  kind: 'thumbnail' | 'poster'
  width: number
  height: number
  url: string
}

export interface PromotionCreativeDraft {
  revision: number
  title: string
  description: string
  thumbnailId: string | null
  posterId: string | null
  qr: { x: number, y: number, size: number }
}

export interface PromotionCreativeSettings extends PromotionCreativeDraft {
  thumbnail: PromotionImage | null
  poster: PromotionImage | null
}

export const defaultPromotionCreative = (): PromotionCreativeDraft => ({
  revision: 0,
  title: 'T方舟｜AI 助手 × 应用平台',
  description: '随时与 AI 对话，按需安装应用。从一句话开始，探索持续扩展的更多可能。',
  thumbnailId: null,
  posterId: null,
  qr: { x: 70.37, y: 84.64, size: 21.48 },
})

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
