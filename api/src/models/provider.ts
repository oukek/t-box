import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ProviderConcurrency } from '../billing/concurrency.js'
import type { ChatProvider, ProviderInput, ProviderUsage } from '../chat/provider.js'
import type { ModelAuditMetadata } from './audit.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { settingNumber } from '../configuration/defaults.js'
import { ModelCallAudit } from './audit.js'
import { ModelRouting } from './routing.js'

/** One pinned model per task; every real request gets its own queue/usage/error/IO record. */
export class AuditedChatProvider implements ChatProvider {
  readonly mode
  readonly configurationKey
  readonly contextPolicy
  readonly maxOutputTokens
  private readonly audit: ModelCallAudit
  private readonly routing: ModelRouting
  constructor(private readonly inner: ChatProvider, private readonly pool: ProviderConcurrency, private readonly model: ModelAuditMetadata & { maxConcurrency: number, providerConcurrency: number }, private readonly configuration: { snapshot(): Promise<ConfigurationSnapshot> }) {
    this.mode = inner.mode
    this.configurationKey = inner.configurationKey
    this.contextPolicy = inner.contextPolicy
    this.maxOutputTokens = inner.maxOutputTokens
    this.audit = new ModelCallAudit(pool.source)
    this.routing = new ModelRouting(pool.source)
  }

  private async execute<T>(method: string, input: Pick<ProviderInput, 'execution' | 'signal' | 'onUsage'>, payload: unknown, invoke: (signal: AbortSignal, onUsage: ProviderInput['onUsage'], onDelta: ProviderInput['onDelta']) => Promise<T>) {
    const configuration = await this.configuration.snapshot()
    const limit = settingNumber(configuration, 'ai.audit.maxPayloadChars', 262144)
    const id = input.execution?.operationId
    if (input.execution) {
      await this.audit.begin(input.execution, this.model, method, payload, limit)
    }
    let renewal: Promise<unknown> | undefined
    const heartbeat = id
      ? setInterval(() => {
          renewal ??= this.audit.heartbeat(id).catch(() => {}).finally(() => {
            renewal = undefined
          })
        }, 25000)
      : undefined
    let usage: ProviderUsage | undefined
    let text = ''
    let textTruncated = false
    const delta = (value: string) => {
      if (text.length + value.length > limit) {
        textTruncated = true
      }
      if (text.length < limit) {
        text += value.slice(0, limit - text.length)
      }
    }
    try {
      const result = await this.pool.run(this.model.providerId, input.signal, configuration, async (signal) => {
        if (id) {
          await this.audit.running(id)
        }
        return invoke(signal, async (value) => {
          usage = value
          await input.onUsage?.(value)
        }, delta)
      }, { id: this.model.billingModelId, maxConcurrency: this.model.maxConcurrency, providerConcurrency: this.model.providerConcurrency })
      if (id) {
        await this.audit.finish(id, this.model, { result, text, textTruncated }, limit, usage).catch(() => console.warn('MODEL_AUDIT_WRITE_FAILED', id))
      }
      await this.routing.success(this.model.billingModelId).catch(() => {})
      return result
    } catch (error) {
      if (id) {
        await this.audit.finish(id, this.model, { partialText: text, textTruncated }, limit, usage, error, input.signal.aborted).catch(() => console.warn('MODEL_AUDIT_WRITE_FAILED', id))
      }
      if (!input.signal.aborted) {
        await this.routing.failure(this.model.billingModelId, error, configuration).catch(() => {})
      }
      throw error
    } finally {
      clearInterval(heartbeat)
      await renewal
    }
  }

  private request<T>(method: string, input: ProviderInput, invoke: (input: ProviderInput) => Promise<T>) {
    return this.execute(method, input, { history: input.history, instructions: input.instructions, tools: input.tools, toolChoice: input.toolChoice, outputTokenBudget: input.outputTokenBudget }, (signal, onUsage, onDelta) => invoke({ ...input, signal, onUsage, onDelta: (text, id) => {
      onDelta(text)
      input.onDelta(text, id)
    } }))
  }

  next(input: ProviderInput) {
    return this.request('next', input, this.inner.next.bind(this.inner))
  }

  compact(input: ProviderInput) {
    if (!this.inner.compact) {
      throw new ApiError(409, 'COMPACTION_DISABLED', '服务商不支持上下文压缩')
    }
    return this.request('compact', input, this.inner.compact.bind(this.inner))
  }

  summarize(input: ProviderInput) {
    if (!this.inner.summarize) {
      throw new ApiError(409, 'SUMMARY_UNSUPPORTED', '服务商不支持摘要压缩')
    }
    return this.request('summarize', input, this.inner.summarize.bind(this.inner))
  }

  countInputTokens(input: ProviderInput) {
    if (!this.inner.countInputTokens) {
      throw new ApiError(409, 'TOKEN_COUNT_UNSUPPORTED', '服务商不支持输入 token 计数')
    }
    return this.request('countInputTokens', input, this.inner.countInputTokens.bind(this.inner))
  }

  title(input: Parameters<NonNullable<ChatProvider['title']>>[0]) {
    return this.execute('title', input, { text: input.text, instructions: input.instructions }, (signal, onUsage) => this.inner.title ? this.inner.title({ ...input, signal, onUsage }) : Promise.resolve(''))
  }
}
