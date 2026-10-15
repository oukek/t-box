import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ChatProvider, ProviderInput } from '../chat/provider.js'
import type { ProviderConcurrency } from './concurrency.js'
import { ApiError } from '@t-box/server-foundation/errors'

export class LimitedChatProvider implements ChatProvider {
  readonly mode
  readonly configurationKey
  readonly contextPolicy
  readonly maxOutputTokens
  constructor(
    private readonly inner: ChatProvider,
    private readonly pool: ProviderConcurrency,
    private readonly providerId: string,
    private readonly configuration: {
      snapshot(): Promise<ConfigurationSnapshot>
    },
  ) {
    this.mode = inner.mode
    this.configurationKey = inner.configurationKey
    this.contextPolicy = inner.contextPolicy
    this.maxOutputTokens = inner.maxOutputTokens
  }

  private async execute<T>(
    signal: AbortSignal,
    invoke: (signal: AbortSignal) => Promise<T>,
  ) {
    return this.pool.run(
      this.providerId,
      signal,
      await this.configuration.snapshot(),
      invoke,
    )
  }

  next(input: ProviderInput) {
    return this.execute(input.signal, (signal) =>
      this.inner.next({ ...input, signal }))
  }

  compact(input: ProviderInput) {
    if (!this.inner.compact) {
      throw new ApiError(409, 'COMPACTION_DISABLED', '服务商不支持上下文压缩')
    }
    return this.execute(input.signal, (signal) =>
      this.inner.compact!({ ...input, signal }))
  }

  summarize(input: ProviderInput) {
    if (!this.inner.summarize) {
      throw new ApiError(409, 'SUMMARY_UNSUPPORTED', '服务商不支持摘要压缩')
    }
    return this.execute(input.signal, (signal) =>
      this.inner.summarize!({ ...input, signal }))
  }

  countInputTokens(input: ProviderInput) {
    if (!this.inner.countInputTokens) {
      throw new ApiError(
        409,
        'TOKEN_COUNT_UNSUPPORTED',
        '服务商不支持输入 token 计数',
      )
    }
    return this.execute(input.signal, (signal) =>
      this.inner.countInputTokens!({ ...input, signal }))
  }

  title(input: Parameters<NonNullable<ChatProvider['title']>>[0]) {
    return this.execute(input.signal, (signal) =>
      this.inner.title
        ? this.inner.title({ ...input, signal })
        : Promise.resolve(''))
  }
}
