import type { BillingService } from '../billing/service.js'
import type { ChatProvider, ProviderInput } from '../chat/provider.js'
import type { ConfigurationService } from './service.js'
import { MeteredChatProvider } from '../billing/provider.js'
import { createConversationProvider } from '../chat/provider-factory.js'
import {
  UnconfiguredProvider,
} from '../chat/provider.js'
/** Resolve once per run, so configuration updates never split a tool loop. */
export class DatabaseChatProvider implements ChatProvider {
  readonly mode = 'unconfigured'
  constructor(
    private readonly configuration: ConfigurationService,
    private readonly billing?: BillingService,
  ) {}

  async forRun(): Promise<ChatProvider> {
    const config = await this.configuration.runtime()
    if (!config) {
      return Object.assign(new UnconfiguredProvider(), {
        configurationKey: 'unconfigured',
      })
    }
    const provider = Object.assign(createConversationProvider(config), {
      configurationKey: config.configurationKey,
    })
    return this.billing
      ? new MeteredChatProvider(
          provider,
          this.billing,
          config.billingModelId,
          config.prices,
        )
      : provider
  }

  async next(_input: ProviderInput): Promise<never> {
    throw new Error('Resolve a database provider before running')
  }
}
