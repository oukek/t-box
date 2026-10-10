import type { ResourceRef } from '@t-box/app-contracts'

export interface Resource {
  id: string
  name: string
  mimeType: string
  size: number
  source: 'uploaded' | 'generated'
  createdAt: string
}
export interface ConversationSummary {
  id: string
  title: string
  updatedAt: string
  messageCount: number
  protectedResources: ResourceRef[]
  unavailable: boolean
}
