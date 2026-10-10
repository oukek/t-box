import type {
  ApplicationToolDefinition,
  ChatMode,
  ContextPolicy,
} from '@t-box/shared'
import type {
  ResponseInputItem,
  ResponseOutputItem,
} from 'openai/resources/responses/responses'
import { createHash } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { contextOutputBudget, resolveContextPolicy } from '@t-box/shared'
import OpenAI from 'openai'
import { settingNumber } from '../configuration/defaults.js'
import { modelParameters } from '../configuration/model-parameters.js'
import { titleInstructions } from '../configuration/prompts.js'
import { providerStream } from './provider-stream.js'

export type ProviderItem = ResponseInputItem
export interface ModelCall {
  id: string
  name: string
  arguments: string
}
export interface ProviderTurn {
  output: ProviderItem[]
  calls: ModelCall[]
}
export interface ProviderInput {
  configuration?: import('@t-box/shared').ConfigurationSnapshot
  execution?: {
    userId: string
    taskId?: string
    messageId?: string
    agentId?: string
    operationId: string
    purpose?: import('@t-box/shared').ModelCallPurpose
  }
  toolChoice?: 'auto' | 'none' | { type: 'function', name: string }
  publicReasoning?: boolean
  /** Internal output override for bounded memory summaries. */
  outputTokenBudget?: number
  onUsage?: (usage: ProviderUsage) => Promise<void>
  history: ProviderItem[]
  tools: ApplicationToolDefinition[]
  signal: AbortSignal
  onDelta: (delta: string, itemId?: string) => void
  onReasoning?: (itemId: string, text: string, delta: boolean) => void
  localDate: string
  instructions: string
}
export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number | null
  cacheWriteTokens?: number | null
  reasoningTokens?: number | null
  responseId: string
  durationMs?: number
}
export interface ChatProvider {
  maxOutputTokens?: number
  mode: ChatMode
  contextPolicy?: ContextPolicy
  countInputTokens?(input: ProviderInput): Promise<number>
  summarize?(input: ProviderInput): Promise<string>
  compact?(input: ProviderInput): Promise<ProviderItem[]>
  configurationKey?: string
  forRun?: () => Promise<ChatProvider>
  next(input: ProviderInput): Promise<ProviderTurn>
  title?(input: {
    text: string
    signal: AbortSignal
    instructions?: string
    outputTokenBudget?: number
    configuration?: import('@t-box/shared').ConfigurationSnapshot
  }): Promise<string>
}

/** No AI configuration means no model response and no tool execution. */
export class UnconfiguredProvider implements ChatProvider {
  readonly mode = 'unconfigured'
  async next(_input: ProviderInput): Promise<never> {
    throw new ApiError(
      503,
      'AI_NOT_CONFIGURED',
      '尚未接入 AI，请先在后台配置并启用普通会话模型。',
    )
  }
}

export interface OpenAIProviderOptions {
  configuration?: import('@t-box/shared').ConfigurationSnapshot
  apiKey: string
  model: string
  baseURL?: string
  supportsVision?: boolean
  supportsReasoning?: boolean
  contextPolicy?: ContextPolicy
}
export class OpenAIResponsesProvider implements ChatProvider {
  readonly mode = 'openai'
  readonly contextPolicy
  readonly maxOutputTokens
  private readonly client: OpenAI
  constructor(
    private readonly options: OpenAIProviderOptions,
    client?: OpenAI,
  ) {
    this.contextPolicy = resolveContextPolicy(options.contextPolicy)
    this.maxOutputTokens = contextOutputBudget(
      this.contextPolicy,
      options.supportsReasoning,
    )
    this.client =
      client ??
      new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        maxRetries: 0,
        timeout: settingNumber(
          options.configuration,
          'ai.provider.timeoutMs',
          180_000,
        ),
        fetch: (url, options) => fetch(url, { ...options, redirect: 'error' }),
      })
  }

  async next(input: ProviderInput): Promise<ProviderTurn> {
    if (
      this.options.supportsVision === false &&
      input.history.some(
        (item) =>
          'content' in item &&
          Array.isArray(item.content) &&
          item.content.some((part) => part.type === 'input_image'),
      )
    ) {
      throw new ApiError(
        409,
        'VISION_MODEL_REQUIRED',
        '当前普通会话模型未启用看图能力，请在后台选择支持图片输入的会话模型并启用看图',
      )
    }
    const started = Date.now()
    const parameters = modelParameters(
      input.configuration ?? this.options.configuration,
      this.options.supportsReasoning,
    )
    const stream = await this.client.responses.create(
      {
        model: this.options.model,
        store: false,
        ...(input.execution
          ? { metadata: { t_box_operation: input.execution.operationId } }
          : {}),
        ...(this.contextPolicy?.promptCacheKey && input.execution
          ? {
              prompt_cache_key: createHash('sha256')
                .update(
                  `tbox:${input.execution.userId}:${input.execution.agentId ?? 'assistant'}`,
                )
                .digest('hex'),
            }
          : {}),
        ...(parameters.temperature === undefined
          ? {}
          : { temperature: parameters.temperature }),
        ...(parameters.top_p === undefined ? {} : { top_p: parameters.top_p }),
        ...(parameters.effort
          ? { reasoning: { effort: parameters.effort } }
          : {}),
        stream: true,
        include: ['reasoning.encrypted_content'],
        ...(this.options.supportsReasoning && input.publicReasoning !== false
          ? {
              reasoning: {
                ...(parameters.effort ? { effort: parameters.effort } : {}),
                summary: 'auto' as const,
              },
            }
          : {}),
        input: input.history,
        tools: input.tools,
        parallel_tool_calls: false,
        ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
        max_output_tokens: input.outputTokenBudget ?? this.maxOutputTokens,
        instructions: input.instructions,
      },
      {
        signal: input.signal,
        timeout: settingNumber(
          input.configuration ?? this.options.configuration,
          'ai.provider.timeoutMs',
          180000,
        ),
      },
    )
    let output: ResponseOutputItem[] | undefined
    for await (const event of providerStream(stream)) {
      input.signal.throwIfAborted()
      if (
        event.type === 'response.output_text.delta' ||
        event.type === 'response.refusal.delta'
      ) {
        input.onDelta(event.delta, `${event.item_id}:${event.content_index}`)
      }
      if (event.type === 'response.reasoning_summary_text.delta') {
        input.onReasoning?.(
          `${event.item_id}:${event.summary_index}`,
          event.delta,
          true,
        )
      }
      if (event.type === 'response.reasoning_summary_text.done') {
        input.onReasoning?.(
          `${event.item_id}:${event.summary_index}`,
          event.text,
          false,
        )
      }
      if (
        [
          'response.completed',
          'response.incomplete',
          'response.failed',
        ].includes(event.type) &&
        'response' in event &&
        event.response.usage
      ) {
        await input.onUsage?.({
          inputTokens: event.response.usage.input_tokens,
          outputTokens: event.response.usage.output_tokens,
          responseId: event.response.id,
          cachedInputTokens:
            event.response.usage.input_tokens_details?.cached_tokens ?? null,
          cacheWriteTokens:
            event.response.usage.input_tokens_details?.cache_write_tokens ??
            null,
          reasoningTokens:
            event.response.usage.output_tokens_details?.reasoning_tokens ??
            null,
          durationMs: Date.now() - started,
        })
      }
      if (event.type === 'response.completed') {
        output = event.response.output
      }
      if (
        event.type === 'response.failed' ||
        event.type === 'response.incomplete' ||
        event.type === 'error'
      ) {
        if (event.type === 'response.incomplete') {
          const reason = event.response.incomplete_details?.reason
          throw new ApiError(
            502,
            'PROVIDER_INCOMPLETE',
            reason === 'max_output_tokens'
              ? '模型输出额度不足，响应未完成'
              : reason === 'content_filter'
                ? '模型响应被服务商内容过滤'
                : '模型响应未完成',
          )
        }
        const failure =
          event.type === 'response.failed' ? event.response.error : event
        const code =
          failure &&
          'code' in failure &&
          typeof failure.code === 'string' &&
          /^[\w.-]{1,80}$/.test(failure.code)
            ? failure.code
            : 'unknown'
        // Keep typed provider errors: SSE may fail after a successful HTTP handshake.
        // A missing status is not a project error and not every failure is retryable.
        throw new OpenAI.APIError(undefined, { code }, undefined, undefined)
      }
    }
    if (!output) {
      throw new ApiError(
        502,
        'PROVIDER_STREAM_CLOSED',
        '模型连接提前结束，未获得完整响应',
      )
    }
    return {
      // Preserve reasoning (including encrypted_content), messages and every call.
      // Only function tools are enabled. SDK's wider output union includes
      // unrelated hosted-tool variants with incompatible input-only statuses.
      output: output as ProviderItem[],
      calls: output
        .filter((item) => item.type === 'function_call')
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        })),
    }
  }

  async countInputTokens(input: ProviderInput): Promise<number> {
    const result = await this.client.responses.inputTokens.count(
      {
        model: this.options.model,
        input: input.history,
        instructions: input.instructions,
        tools: input.tools,
        parallel_tool_calls: false,
        ...(input.toolChoice ? { tool_choice: input.toolChoice } : {}),
      },
      {
        signal: input.signal,
        timeout: settingNumber(
          input.configuration ?? this.options.configuration,
          'ai.provider.timeoutMs',
          180000,
        ),
      },
    )
    if (!Number.isSafeInteger(result.input_tokens) || result.input_tokens < 0) {
      throw new ApiError(
        502,
        'TOKEN_COUNT_INVALID',
        '服务商返回了无效的上下文 token 计数',
      )
    }
    return result.input_tokens
  }

  async summarize(input: ProviderInput): Promise<string> {
    let text = ''
    const turn = await this.next({
      ...input,
      tools: [],
      toolChoice: 'none',
      publicReasoning: false,
      onReasoning: undefined,
      onDelta: (delta) => {
        text += delta
      },
      // Hidden reasoning also consumes this budget, so don't cap reasoning models to summary length.
      outputTokenBudget: this.options.supportsReasoning
        ? this.maxOutputTokens
        : Math.min(
            this.maxOutputTokens,
            Math.max(
              4096,
              (this.contextPolicy.summaryTargetTokens ?? 2048) * 2,
            ),
          ),
    })
    const completed = turn.output
      .flatMap((item) => {
        if (!('role' in item) || item.role !== 'assistant') {
          return []
        }
        if (typeof item.content === 'string') {
          return [item.content]
        }
        return item.content.flatMap((part) =>
          part.type === 'output_text' ? [part.text] : [],
        )
      })
      .join('\n')
    if (turn.calls.length || !(completed || text).trim()) {
      throw new ApiError(502, 'SUMMARY_INVALID', '模型未返回有效的上下文摘要')
    }
    return (completed || text).trim()
  }

  async compact(input: ProviderInput): Promise<ProviderItem[]> {
    if (!this.contextPolicy?.compaction) {
      throw new ApiError(
        409,
        'COMPACTION_DISABLED',
        '当前模型未启用上下文压缩',
      )
    }
    const started = Date.now()
    const response = await this.client.responses.compact(
      {
        model: this.options.model,
        input: input.history,
        instructions: input.instructions,
      },
      {
        signal: input.signal,
        timeout: settingNumber(
          input.configuration ?? this.options.configuration,
          'ai.provider.timeoutMs',
          180000,
        ),
      },
    )
    if (response.usage) {
      await input.onUsage?.({
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cachedInputTokens:
          response.usage.input_tokens_details?.cached_tokens ?? null,
        cacheWriteTokens:
          response.usage.input_tokens_details?.cache_write_tokens ?? null,
        reasoningTokens:
          response.usage.output_tokens_details?.reasoning_tokens ?? null,
        responseId: response.id,
        durationMs: Date.now() - started,
      })
    }
    if (
      !response.output.length ||
      !response.output.some((x) => x.type === 'compaction')
    ) {
      throw new ApiError(
        502,
        'COMPACTION_INVALID',
        '服务商未返回有效的上下文压缩结果',
      )
    }
    return response.output as ProviderItem[]
  }

  async title(input: {
    text: string
    signal: AbortSignal
    instructions?: string
    outputTokenBudget?: number
    configuration?: import('@t-box/shared').ConfigurationSnapshot
  }): Promise<string> {
    const response = await this.client.responses.create(
      {
        model: this.options.model,
        store: false,
        instructions: input.instructions ?? titleInstructions,
        input: input.text.slice(0, 2000),
        max_output_tokens:
          input.outputTokenBudget ??
          settingNumber(
            input.configuration,
            this.options.supportsReasoning
              ? 'ai.title.reasoningTokens'
              : 'ai.title.outputTokens',
            this.options.supportsReasoning ? 1024 : 128,
          ),
        tools: [],
      },
      {
        signal: input.signal,
        timeout: settingNumber(
          input.configuration ?? this.options.configuration,
          'ai.provider.timeoutMs',
          180000,
        ),
      },
    )
    if (response.status !== 'completed') {
      throw new Error('Title response incomplete')
    }
    return response.output_text
  }
}
