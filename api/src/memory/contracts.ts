import type {
  AiMemory,
  ChatMessage,
  ConfigurationSnapshot,
  MemoryKind,
} from '@t-box/shared'
import type { Actor } from '../agent/contracts.js'

export interface MemoryInput {
  label: string
  content: string
  kind: MemoryKind
  ttlDays: number | null
}
export interface MemorySource {
  conversationId: string
  messageId: string
  contentHash: string
  excerpt: string
}
/** Host port only; application SDKs never receive a memory store or another application's data. */
export interface MemoryPort {
  recall(
    actor: Actor,
    query: string,
    ids: string[],
    configuration?: ConfigurationSnapshot,
  ): Promise<string>
  search(
    actor: Actor,
    query: string,
  ): Promise<Pick<AiMemory, 'id' | 'label' | 'kind'>[]>
  remember(
    actor: Actor,
    input: MemoryInput,
    source: { conversationId: string, message: ChatMessage },
    operationId: string,
  ): Promise<Pick<AiMemory, 'id' | 'label'>>
  forget(actor: Actor, id: string): Promise<void>
}
