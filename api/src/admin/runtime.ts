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
/** Keep a model until an explicit, checkpointed failover; never swap inside a tool call. */
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
    return Object.assign(audited, {
      modelIdentity: { modelId: config.billingModelId, providerId: config.providerId },
      // Explicit memory-extraction model selection remains an administrator constraint.
      ...(options?.modelId || options?.peek
        ? {}
        : {
            failover: (selection: Parameters<NonNullable<ChatProvider['failover']>>[0]) =>
              this.forRun({ ...selection, supportsVision: options?.supportsVision || selection.supportsVision }),
          }),
    })
  }

  async next(_input: ProviderInput): Promise<never> {
    throw ErrorCode.INTERNAL_RESOLVE_A_DATABASE_PROVIDER_BEFORE_RUNNING()
  }
}
