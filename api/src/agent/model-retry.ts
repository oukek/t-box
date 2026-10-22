import type { RunError } from '../chat/errors.js'
import type { ProviderInput, ProviderUsage } from '../chat/provider.js'
import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { ApiError } from '@t-box/server-foundation/errors'
import OpenAI from 'openai'
import { publicRunError } from '../chat/errors.js'
import { settingNumber } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'

export const MAX_MODEL_RETRIES = 5
/** Stored with the frame, including successful compaction parts until the turn commits. */
export interface ModelRequestRecord {
  id: string
  retries: number
  status: 'ready' | 'in_flight' | 'waiting' | 'failed' | 'completed'
  nextAttemptAt?: number
  error?: RunError
  result?: unknown
}
export interface RetryProgress {
  id: string
  attempt: number
  maxRetries: number
  delayMs: number
  error: RunError
}
/** Automatic retry is narrower than manual task resumption. Never retry host/billing/tool errors. */
export function retryableModelError(error: unknown): boolean {
  if (error instanceof ApiError) {
    return ['PROVIDER_STREAM_CLOSED', 'PROVIDER_FAILED', 'MEMORY_EXTRACTION_INVALID'].includes(error.code)
  }
  if (!(error instanceof OpenAI.APIError)) {
    return false
  }
  const failure = publicRunError(error)
  return failure.retryable && failure.code !== 'RUN_INTERNAL_ERROR'
}
function retryAfter(error: unknown, now: number): number | undefined {
  if (!(error instanceof OpenAI.APIError)) {
    return
  }
  const ms = error.headers?.get('retry-after-ms')
  if (ms && /^\d+(?:\.\d+)?$/.test(ms)) {
    return Number(ms)
  }
  const value = error.headers?.get('retry-after')
  if (!value) {
    return
  }
  if (/^\d+(?:\.\d+)?$/.test(value)) {
    return Number(value) * 1000
  }
  const date = Date.parse(value)
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined
}
export interface ModelRequestOptions {
  records: Record<string, ModelRequestRecord>
  save(): Promise<void>
  onRetry(progress: RetryProgress): Promise<void>
  onAttempt?(id: string): void
  onUsage: (usage: ProviderUsage, operationId: string) => Promise<void>
  // Deterministic clocks/delays are used by failure/recovery tests, not user configuration.
  now?: () => number
  random?: () => number
  wait?: (ms: number, signal: AbortSignal) => Promise<void>
}
/** Retry one provider request, retaining its exact input. No application tools run in this loop. */
export async function modelRequest<T>(
  method: string,
  input: ProviderInput,
  invoke: (input: ProviderInput) => Promise<T>,
  options: ModelRequestOptions,
): Promise<T> {
  const now = options.now ?? Date.now
  const wait =
    options.wait ??
    (async (ms, signal) => {
      await delay(ms, undefined, { signal })
    })
  const maxRetries = settingNumber(
    input.configuration,
    'ai.retry.maxRetries',
    MAX_MODEL_RETRIES,
  )
  const key = createHash('sha256')
    .update(
      JSON.stringify({
        method,
        history: input.history,
        tools: input.tools,
        instructions: input.instructions,
        toolChoice: input.toolChoice,
        publicReasoning: input.publicReasoning,
        outputTokenBudget: input.outputTokenBudget,
        localDate: input.localDate,
        purpose: input.execution?.purpose,
      }),
    )
    .digest('hex')
  const record = (options.records[key] ||= {
    id: randomUUID(),
    retries: 0,
    status: 'ready',
  })
  if (record.status === 'completed') {
    return structuredClone(record.result) as T
  }
  const schedule = async (error: unknown, recovered = false) => {
    const failure = recovered
      ? {
          code: 'PROVIDER_INTERRUPTED',
          message: '上次模型请求未完成',
          retryable: true,
        }
      : publicRunError(error)
    if (!recovered && !retryableModelError(error)) {
      record.status = 'failed'
      record.error = failure
      throw error
    }
    if (record.retries >= maxRetries) {
      record.status = 'failed'
      record.error = failure
      throw ErrorCode.MODEL_RETRIES_EXHAUSTED(
        `${failure.message}；已自动重试 ${maxRetries} 次仍未成功`,
      )
    }
    record.retries++
    const backoff =
      Math.min(
        settingNumber(input.configuration, 'ai.retry.maxDelayMs', 16000),
        settingNumber(input.configuration, 'ai.retry.baseDelayMs', 1000) *
        2 ** (record.retries - 1),
      ) *
      (1 + (options.random ?? Math.random)() * 0.25)
    // Do not cap a provider's Retry-After and send earlier than requested. The run deadline still applies.
    const delayMs = Math.max(backoff, retryAfter(error, now()) ?? 0)
    record.nextAttemptAt = now() + delayMs
    record.status = 'waiting'
    record.error = failure
    await options.onRetry({
      id: record.id,
      attempt: record.retries,
      maxRetries,
      delayMs,
      error: failure,
    })
    await options.save()
  }
  // A recovered in-flight request has no committed response. Consume a retry instead of resetting the budget.
  if (record.status === 'in_flight') {
    await schedule(undefined, true)
  }
  if (record.status === 'failed') {
    // Manual resumption may try once after operator intervention; automatic budget never resets.
    record.status = 'ready'
  }
  for (;;) {
    input.signal.throwIfAborted()
    if (record.status === 'waiting') {
      await wait(
        Math.max(0, (record.nextAttemptAt ?? now()) - now()),
        input.signal,
      )
      input.signal.throwIfAborted()
    }
    const operationId = randomUUID()
    record.status = 'in_flight'
    delete record.nextAttemptAt
    await options.save()
    options.onAttempt?.(operationId)
    let usageCallbackFailed = false
    try {
      const result = await invoke({
        ...input,
        execution: input.execution
          ? {
              ...input.execution,
              operationId,
              logicalRequestId: record.id,
              retryIndex: record.retries,
            }
          : undefined,
        onUsage: async (usage) => {
          try {
            await options.onUsage(usage, operationId)
          } catch (error) {
            usageCallbackFailed = true
            throw error
          }
        },
      })
      input.signal.throwIfAborted()
      record.status = 'completed'
      record.result = structuredClone(result)
      // Save outside the retry catch: storage failures must never replay a successful provider call.
    } catch (error) {
      if (input.signal.aborted || usageCallbackFailed) {
        throw error
      }
      await schedule(error)
      continue
    }
    await options.save()
    return structuredClone(record.result) as T
  }
}
