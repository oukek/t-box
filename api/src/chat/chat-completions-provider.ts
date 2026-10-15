import type {
  ChatProvider,
  ModelCall,
  OpenAIProviderOptions,
  ProviderInput,
  ProviderTurn,
} from './provider.js'
import { createHash } from 'node:crypto'
import { ApiError } from '@t-box/server-foundation/errors'
import { contextOutputBudget, resolveContextPolicy } from '@t-box/shared'
import OpenAI from 'openai'
import { settingNumber } from '../configuration/defaults.js'
import { modelParameters } from '../configuration/model-parameters.js'
import { titleInstructions } from '../configuration/prompts.js'
import { chatMessages } from './chat-messages.js'
import { invocationContextPolicy } from './invocation-mode.js'
import { providerStream } from './provider-stream.js'

export class OpenAIChatCompletionsProvider implements ChatProvider {
  readonly mode = 'openai'
  readonly contextPolicy
  readonly maxOutputTokens
  private readonly client: OpenAI
  constructor(
    private readonly options: OpenAIProviderOptions,
    client?: OpenAI,
  ) {
    this.contextPolicy = invocationContextPolicy(
      'chat_completions',
      resolveContextPolicy(options.contextPolicy),
    )
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
        fetch: (url, init) => fetch(url, { ...init, redirect: 'error' }),
      })
  }

  async next(input: ProviderInput): Promise<ProviderTurn> {
    const started = Date.now()
    const parameters = modelParameters(
      input.configuration ?? this.options.configuration,
      this.options.supportsReasoning,
    )
    const stream = await this.client.chat.completions.create(
      {
        model: this.options.model,
        messages: chatMessages(
          input.history,
          input.instructions,
          this.options.supportsVision,
        ),
        ...(parameters.temperature === undefined
          ? {}
          : { temperature: parameters.temperature }),
        ...(parameters.top_p === undefined ? {} : { top_p: parameters.top_p }),
        ...(parameters.effort ? { reasoning_effort: parameters.effort } : {}),
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: input.outputTokenBudget ?? this.maxOutputTokens,
        ...(input.tools.length
          ? {
              tools: input.tools.map(
                ({ name, description, parameters, strict }) => ({
                  type: 'function' as const,
                  function: {
                    name,
                    description: description ?? undefined,
                    parameters,
                    strict,
                  },
                }),
              ),
              parallel_tool_calls: false,
            }
          : {}),
        ...(input.toolChoice &&
          (input.tools.length || input.toolChoice !== 'none')
          ? {
              tool_choice:
                typeof input.toolChoice === 'object'
                  ? {
                      type: 'function' as const,
                      function: { name: input.toolChoice.name },
                    }
                  : input.toolChoice,
            }
          : {}),
        ...(this.contextPolicy.promptCacheKey && input.execution
          ? {
              prompt_cache_key: createHash('sha256')
                .update(
                  `tbox:${input.execution.userId}:${input.execution.agentId ?? 'assistant'}`,
                )
                .digest('hex'),
            }
          : {}),
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
    let text = ''
    let responseId = ''
    let finish: string | null = null
    let refusal = ''
    let usageReported = false
    const calls = new Map<number, ModelCall>()
    for await (const chunk of providerStream(stream)) {
      input.signal.throwIfAborted()
      if (responseId && chunk.id && chunk.id !== responseId) {
        throw new ApiError(502, 'PROVIDER_FAILED', '模型响应标识不一致')
      }
      responseId ||= chunk.id
      if (chunk.usage && !usageReported) {
        usageReported = true
        await input.onUsage?.({
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          cachedInputTokens:
            chunk.usage.prompt_tokens_details?.cached_tokens ?? null,
          reasoningTokens:
            chunk.usage.completion_tokens_details?.reasoning_tokens ?? null,
          responseId,
          durationMs: Date.now() - started,
        })
      }
      for (const choice of chunk.choices) {
        if (choice.index !== 0) {
          throw new ApiError(
            502,
            'PROVIDER_FAILED',
            '模型返回了非预期的多项响应',
          )
        }
        if (choice.delta.content) {
          text += choice.delta.content
          input.onDelta(choice.delta.content, responseId)
        }
        refusal += choice.delta.refusal ?? ''
        for (const delta of choice.delta.tool_calls ?? []) {
          if (
            !Number.isSafeInteger(delta.index) ||
            delta.index < 0 ||
            delta.index > 127 ||
            (delta.type && delta.type !== 'function')
          ) {
            throw new ApiError(502, 'PROVIDER_FAILED', '模型工具调用格式无效')
          }
          const call = calls.get(delta.index) ?? {
            id: '',
            name: '',
            arguments: '',
          }
          if (delta.id) {
            if (call.id && call.id !== delta.id) {
              throw new ApiError(
                502,
                'PROVIDER_FAILED',
                '模型工具调用标识不一致',
              )
            }
            call.id = delta.id
          }
          call.name += delta.function?.name ?? ''
          call.arguments += delta.function?.arguments ?? ''
          calls.set(delta.index, call)
        }
        if (choice.finish_reason) {
          finish = choice.finish_reason
        }
      }
    }
    if (!finish) {
      throw new ApiError(
        502,
        'PROVIDER_STREAM_CLOSED',
        '模型连接提前结束，未获得完整响应',
      )
    }
    if (!['stop', 'tool_calls'].includes(finish)) {
      throw new ApiError(
        502,
        'PROVIDER_INCOMPLETE',
        finish === 'length'
          ? '模型输出额度不足，响应未完成'
          : finish === 'content_filter'
            ? '模型响应被服务商内容过滤'
            : '模型响应未完成',
      )
    }
    if (refusal) {
      throw new ApiError(502, 'PROVIDER_REFUSED', '模型拒绝了本次请求')
    }
    const completed = [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, call]) => call)
    if (
      (finish === 'tool_calls') !== Boolean(completed.length) ||
      completed.some((c) => !c.id || !c.name || !c.arguments) ||
      new Set(completed.map((c) => c.id)).size !== completed.length
    ) {
      throw new ApiError(502, 'PROVIDER_FAILED', '模型未返回完整的工具调用')
    }
    if (!completed.length && !text.trim()) {
      throw new ApiError(502, 'PROVIDER_FAILED', '模型未返回有效内容')
    }
    return {
      output: [
        ...(text
          ? [
              {
                type: 'message' as const,
                role: 'assistant' as const,
                status: 'completed' as const,
                id: responseId,
                content: [
                  { type: 'output_text' as const, text, annotations: [] },
                ],
              },
            ]
          : []),
        ...completed.map((c) => ({
          type: 'function_call' as const,
          call_id: c.id,
          name: c.name,
          arguments: c.arguments,
        })),
      ],
      calls: completed,
    }
  }

  async summarize(input: ProviderInput): Promise<string> {
    let text = ''
    const turn = await this.next({
      ...input,
      tools: [],
      toolChoice: 'none',
      onReasoning: undefined,
      onDelta: (delta) => {
        text += delta
      },
      outputTokenBudget: this.options.supportsReasoning
        ? this.maxOutputTokens
        : Math.min(
            this.maxOutputTokens,
            Math.max(4096, this.contextPolicy.summaryTargetTokens * 2),
          ),
    })
    if (turn.calls.length || !text.trim()) {
      throw new ApiError(502, 'SUMMARY_INVALID', '模型未返回有效的上下文摘要')
    }
    return text.trim()
  }

  async title(input: {
    onUsage?: ProviderInput['onUsage']
    text: string
    signal: AbortSignal
    instructions?: string
    outputTokenBudget?: number
    configuration?: import('@t-box/shared').ConfigurationSnapshot
  }): Promise<string> {
    let text = ''
    await this.next({
      onUsage: input.onUsage,
      configuration: input.configuration,
      history: [{ role: 'user', content: input.text.slice(0, 2000) }],
      instructions: input.instructions ?? titleInstructions,
      localDate: '',
      tools: [],
      toolChoice: 'none',
      signal: input.signal,
      onDelta: (delta) => {
        text += delta
      },
      outputTokenBudget:
        input.outputTokenBudget ??
        settingNumber(
          input.configuration,
          this.options.supportsReasoning
            ? 'ai.title.reasoningTokens'
            : 'ai.title.outputTokens',
          this.options.supportsReasoning ? 1024 : 128,
        ),
    })
    return text
  }
}
