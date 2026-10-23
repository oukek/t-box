/** Administrative views. Never expose these contracts through end-user conversation APIs. */
export interface OperationsUser {
  id: string
  username: string
  nickname: string
}
export interface OperationsModel {
  id: string
  name: string
  remoteModel: string
  providerId: string
  providerName: string
}
export interface OperationsPage<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}
export type ModelCallStatus =
  'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface OperationsModelCall extends OperationsModel {
  callId: string
  logicalId: string
  retryIndex: number
  taskId: string | null
  messageId: string | null
  user: OperationsUser
  purpose: string
  method: string
  invocationMode: string
  status: ModelCallStatus
  billingStatus: string | null
  cost: string | null
  charged: string | null
  inputTokens: number | null
  outputTokens: number | null
  cachedInputTokens: number | null
  cacheWriteTokens: number | null
  reasoningTokens: number | null
  images: number | null
  durationMs: number | null
  queueMs: number | null
  userError: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}
export interface OperationsModelCallDetail extends OperationsModelCall {
  originalCost?: string | null
  expectedQuota?: string | null
  billingMode?: import('./billing.js').BillingMode | null
  tariff?: unknown
  allocations?: import('./quota.js').QuotaAllocation[]
  input: unknown
  output: unknown
  diagnostics: unknown
  providerRequestId: string | null
  responseId: string | null
  prices: unknown
}
export interface OperationsTaskRow {
  id: string
  user: OperationsUser
  conversationId: string
  requestId: string
  status: string
  agentId: string
  reason: string | null
  recoveryAttempts: number
  retryCount: number
  calls: number
  failedCalls: number
  models: OperationsModel[]
  cost: string
  charged: string
  unresolved: number
  inputTokens: number
  outputTokens: number
  createdAt: string
  updatedAt: string
}
