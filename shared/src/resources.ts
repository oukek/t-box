import type { ResourceRef } from '@t-box/app-contracts'

export interface Resource {
  id: string
  name: string
  mimeType: string
  size: number
  source: 'uploaded' | 'generated'
  createdAt: string
  /** Object key relative to its storage root; never a provider, CDN or signed URL. */
  path?: string
}
export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
  protectedResources: ResourceRef[]
  unavailable: boolean
}
