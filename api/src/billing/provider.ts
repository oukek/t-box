import type { ModelPrices } from '@t-box/shared'
import type { ChatProvider, ProviderInput } from '../chat/provider.js'
import type { BillingService } from './service.js'
import { ApiError } from '@t-box/server-foundation/errors'
import { estimateInputTokens } from '../agent/context.js'
import { settingNumber } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'
import { money, tokenFee } from './money.js'

export class MeteredChatProvider implements ChatProvider {
  readonly mode
  readonly configurationKey
  readonly contextPolicy
  readonly maxOutputTokens
  constructor(
    private readonly provider: ChatProvider,
    private readonly billing: BillingService,
    private readonly modelId: string,
    private readonly prices: ModelPrices,
  ) {
    this.contextPolicy = provider.contextPolicy
    this.maxOutputTokens = provider.maxOutputTokens
    this.mode = provider.mode
    this.configurationKey = provider.configurationKey
  }

  async next(input: ProviderInput) {
    return this.meter(
      input,
      this.provider.next.bind(this.provider),
      input.execution?.purpose ?? 'response',
    )
  }

  async compact(input: ProviderInput) {
    if (!this.provider.compact) {
      throw ErrorCode.COMPACTION_DISABLED()
    }
    return this.meter(
      input,
      this.provider.compact.bind(this.provider),
      'compaction',
    )
  }

  async countInputTokens(input: ProviderInput) {
    if (!this.provider.countInputTokens) {
      throw ErrorCode.TOKEN_COUNT_UNSUPPORTED(
        '服务商不支持输入 token 计数，请关闭此能力',
      )
    }
    return this.provider.countInputTokens(input)
  }

  async summarize(input: ProviderInput) {
    if (!this.provider.summarize) {
      throw ErrorCode.SUMMARY_UNSUPPORTED()
    }
    return this.meter(
      input,
      this.provider.summarize.bind(this.provider),
      'compaction',
    )
  }

  private async meter<T>(
    input: ProviderInput,
    invoke: (input: ProviderInput) => Promise<T>,
    purpose: import('@t-box/shared').ModelCallPurpose,
  ): Promise<T> {
    const execution = input.execution
    if (!execution) {
      throw ErrorCode.BILLING_IDENTITY_REQUIRED()
    }
    input.signal.throwIfAborted()
    // Conservative admission budget, not billable usage. JSON/UTF-8 includes
    // tool schemas, attachments and prior reasoning; final fee uses usage only.
    const estimate = estimateInputTokens(input)
    const mode = await this.billing.begin({
      id: execution.operationId,
      userId: execution.userId,
      taskId: execution.taskId,
      messageId: execution.messageId,
      agentId: execution.agentId,
      purpose,
      modelId: this.modelId,
      prices: this.prices,
      kind: 'conversation',
      reserve: tokenFee(
        this.prices,
        estimate,
        input.outputTokenBudget ?? this.maxOutputTokens ?? 8192,
      ),
    })
    let settled = false
    try {
      const turn = await invoke({
        ...input,
        onUsage: async (usage) => {
          try {
            await this.billing.settle(
              execution.userId,
              execution.operationId,
              usage,
            )
          } catch (error) {
            if (error instanceof ApiError && error.code === 'USAGE_REVIEW') {
              await input.onUsage?.(usage)
            }
            throw error
          }
          settled = true
          await input.onUsage?.(usage)
        },
      })
      if (!settled) {
        await this.billing.uncertain(execution.userId, execution.operationId)
        // Missing metering must not disable genuine free/waived model output.
        // Keep an unknown-usage audit record, but only paid calls need a fee gate.
        if (
          mode === 'record_only' ||
          (money(this.prices.inputPrice) === 0n &&
            money(this.prices.outputPrice) === 0n)
        ) {
          return turn
        }
        throw ErrorCode.USAGE_MISSING()
      }
      return turn
    } catch (error) {
      if (!settled) {
        await this.billing.uncertain(execution.userId, execution.operationId)
      }
      throw error
    }
  }

  // Free to the user; provider overhead still belongs to the platform budget.
  async title(input: Parameters<NonNullable<ChatProvider['title']>>[0]) {
    if (!this.provider.title) {
      return ''
    }
    if (!input.execution) {
      return this.provider.title(input)
    }
    const execution = input.execution
    const output =
      input.outputTokenBudget ??
      settingNumber(input.configuration, 'ai.title.reasoningTokens', 1024)
    const estimate = estimateInputTokens({
      history: [{ role: 'user', content: input.text.slice(0, 2000) }],
      tools: [],
      instructions: input.instructions || '',
    })
    await this.billing.begin({
      id: execution.operationId,
      userId: execution.userId,
      taskId: execution.taskId,
      modelId: this.modelId,
      prices: this.prices,
      kind: 'conversation',
      purpose: 'title',
      free: true,
      reserve: tokenFee(this.prices, estimate, output),
    })
    let settled = false
    try {
      const title = await this.provider.title({
        ...input,
        onUsage: async (usage) => {
          await this.billing.settle(
            execution.userId,
            execution.operationId,
            usage,
          )
          settled = true
          await input.onUsage?.(usage)
        },
      })
      if (!settled) {
        await this.billing.uncertain(execution.userId, execution.operationId)
      }
      return title
    } catch (error) {
      if (!settled) {
        await this.billing.uncertain(execution.userId, execution.operationId)
      }
      throw error
    }
  }
}
