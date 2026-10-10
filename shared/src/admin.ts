import type { ModelPrices } from './billing.js'

export interface ContextPolicy {
  maxInputTokens: number
  compaction: boolean
  promptCacheKey: boolean
  compactionMode?: 'off' | 'summary' | 'native'
  /** 0 uses 32768 for reasoning models, 8192 for other models. */
  maxOutputTokens?: number
  /** 0 means unknown; administrators must verify the provider's actual window. */
  contextWindowTokens?: number
  compactionThreshold?: number
  keepRecentTurns?: number
  summaryTargetTokens?: number
  tokenCounting?: boolean
}
export interface Administrator {
  id: string
  username: string
  enabled: boolean
  createdAt: string
}
export interface AIProviderConfig {
  id: string
  name: string
  baseUrl: string
  enabled: boolean
  hasKey: boolean
  revision: number
}
export type ModelInvocationMode = 'responses' | 'chat_completions' | 'images'
export interface AIModelConfig extends ModelPrices {
  /** Legacy clients may omit this; the backend always returns the stored mode. */
  invocationMode?: ModelInvocationMode
  purpose: 'conversation' | 'image'
  supportsVision: boolean
  supportsReasoning?: boolean
  contextPolicy?: ContextPolicy
  id: string
  providerId: string
  providerName: string
  modelId: string
  name: string
  enabled: boolean
}
export interface AISettings {
  modelId: string | null
  imageModelId: string | null
}
export interface RemoteModel {
  id: string
  ownedBy: string
}

export const DEFAULT_CONTEXT_POLICY = {
  maxInputTokens: 98304,
  compaction: true,
  promptCacheKey: false,
  compactionMode: 'summary',
  maxOutputTokens: 0,
  contextWindowTokens: 0,
  compactionThreshold: 0.75,
  keepRecentTurns: 4,
  summaryTargetTokens: 2048,
  tokenCounting: false,
} satisfies Required<ContextPolicy>
/** Legacy compaction meant native Responses support, not portable summaries. */
export function resolveContextPolicy(
  policy?: ContextPolicy,
): Required<ContextPolicy> {
  return {
    ...DEFAULT_CONTEXT_POLICY,
    ...policy,
    compactionMode:
      policy?.compactionMode ??
      (policy ? (policy.compaction ? 'native' : 'off') : 'summary'),
  }
}
export function contextOutputBudget(policy?: ContextPolicy, reasoning = false) {
  return policy?.maxOutputTokens || (reasoning ? 32768 : 8192)
}
