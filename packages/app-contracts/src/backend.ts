import type { BackendInvocation } from './index.js'

/** No business writes/external effects are allowed during preparation. Receipts belong to the app. */
export interface BackendPreparation {
  invocation: BackendInvocation
  continuation?: string
  response?: { ok: boolean, data?: unknown, error?: { code: string, message: string } }
}
export type BackendPreparationResult =
  | { status: 'ready', ticket?: string } |
  { status: 'interaction', continuation: string, request: { name: string, arguments: unknown } }

export interface BackendEventRequest {
  appId: string
  releaseId: string
  generation: number
  subject: string
  channel: string
  cursor?: string
  arguments?: unknown
}
export interface BackendEventBatch {
  cursor: string
  events: unknown[]
}
