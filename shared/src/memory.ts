export type MemoryKind = 'preference' | 'fact' | 'goal'
export type MemoryStatus = 'active' | 'candidate'
export interface AiMemory {
  id: string
  label: string
  content: string
  kind: MemoryKind
  status: MemoryStatus
  origin: 'manual' | 'conversation' | 'extracted'
  version: number
  createdAt: string
  updatedAt: string
  expiresAt: string | null
  sources: { conversationId: string, messageId: string, excerpt: string }[]
}
export interface MemorySettings {
  enabled: boolean
  autoExtract: boolean
  revision: number
}
export interface MemoryView {
  available: boolean
  settings: MemorySettings
  items: AiMemory[]
  extraction: { queued: number, failed: number, lastError?: string }
}
/** Safe, app-independent task state. Success is represented by receipt IDs, never inferred steps. */
export interface TaskWorkingMemory {
  version: 1
  requestMessageId: string
  goal: string
  phase: string
  plannedSteps: string[]
  completedCallIds: string[]
  pendingCallNames: string[]
}
