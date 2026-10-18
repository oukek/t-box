import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ChatProvider, ProviderInput } from '../chat/provider.js'
import type { ProviderConcurrency } from './concurrency.js'
import { ErrorCode } from '../error-codes.js'

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
      throw ErrorCode.COMPACTION_DISABLED()
    }
    return this.execute(input.signal, (signal) =>
      this.inner.compact!({ ...input, signal }))
  }

  summarize(input: ProviderInput) {
    if (!this.inner.summarize) {
      throw ErrorCode.SUMMARY_UNSUPPORTED()
    }
    return this.execute(input.signal, (signal) =>
      this.inner.summarize!({ ...input, signal }))
  }

  countInputTokens(input: ProviderInput) {
    if (!this.inner.countInputTokens) {
      throw ErrorCode.TOKEN_COUNT_UNSUPPORTED()
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
