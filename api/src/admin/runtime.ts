import type { ProviderConcurrency } from '../billing/concurrency.js'
import type { BillingService } from '../billing/service.js'
import type { ChatProvider, ProviderInput } from '../chat/provider.js'
import type { ConfigurationService } from './service.js'
import { ProtectedChatProvider } from '../ai-security/provider.js'
import { MeteredChatProvider } from '../billing/provider.js'
import { createConversationProvider } from '../chat/provider-factory.js'
import { UnconfiguredProvider } from '../chat/provider.js'
import { ErrorCode } from '../error-codes.js'
import { AuditedChatProvider } from '../models/provider.js'
/** Resolve once per run, so configuration updates never split a tool loop. */
export class DatabaseChatProvider implements ChatProvider {
  readonly mode = 'unconfigured'
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly billing?: BillingService,
    private readonly concurrency?: ProviderConcurrency,
  ) {}

  async forRun(
    options?: Parameters<ConfigurationService['runtime']>[1],
  ): Promise<ChatProvider> {
    const config = await this.configuration.runtime('conversation', options)
    if (!config) {
      return Object.assign(new UnconfiguredProvider(), {
        configurationKey: 'unconfigured',
      })
    }
    const provider = Object.assign(createConversationProvider(config), {
      configurationKey: config.configurationKey,
    })
    const metered = this.billing
      ? new MeteredChatProvider(
          new ProtectedChatProvider(provider, config),
          this.billing,
          config.billingModelId,
          config.prices,
        )
      : new ProtectedChatProvider(provider, config)
    const audited = this.concurrency
      ? new AuditedChatProvider(
          metered,
          this.concurrency,
          config,
          this.configuration.configuration,
        )
      : metered
    return audited
  }

  async next(_input: ProviderInput): Promise<never> {
    throw ErrorCode.INTERNAL_RESOLVE_A_DATABASE_PROVIDER_BEFORE_RUNNING()
  }
}
