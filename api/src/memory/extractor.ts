import type { ConfigurationSnapshot } from '@t-box/shared'
import type { ChatProvider } from '../chat/provider.js'
import type { MemoryJobRow } from '../db/records/memory-entities.js'
import type { MemoryInput } from './contracts.js'
import { contextInputBudget } from '@t-box/shared'
import OpenAI from 'openai'
import { modelRequest } from '../agent/model-retry.js'
import { definition, nullable } from '../agent/schema.js'
import { estimateInputTokens } from '../agent/token-estimate.js'
import { secureInstructions } from '../ai-security/policy.js'
import { settingNumber, settingText } from '../configuration/defaults.js'
import { ErrorCode } from '../error-codes.js'
import { memoryInput } from './policy.js'
import { memoryExtractionPrompt } from './prompts.js'

const schema = definition(
  'memory_extract',
  '提交用户长期偏好或阶段目标的候选；没有可提取信息时 items 为空。',
  {
    items: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        properties: {
          slot: { type: 'string', maxLength: 80 },
          label: { type: 'string', maxLength: 80 },
          content: { type: 'string', maxLength: 300 },
          kind: { type: 'string', enum: ['preference', 'goal'] },
          ttlDays: nullable({ type: 'integer', minimum: 1, maximum: 90 }),
        },
        required: ['slot', 'label', 'content', 'kind', 'ttlDays'],
        additionalProperties: false,
      },
    },
  },
)
export function extractionResult(
  value: unknown,
): (MemoryInput & { slot: string })[] {
  if (
    !value ||
    typeof value !== 'object' ||
    !('items' in value) ||
    !Array.isArray(value.items) ||
    value.items.length > 5 ||
    Object.keys(value).some((key) => key !== 'items')
  ) {
    throw ErrorCode.MEMORY_EXTRACTION_INVALID()
  }
  const result = value.items.map((raw: unknown) => {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('slot' in raw) ||
      typeof raw.slot !== 'string' ||
      !/^[a-z][a-z0-9_.-]{1,79}$/.test(raw.slot)
    ) {
      throw ErrorCode.MEMORY_EXTRACTION_INVALID()
    }
    const { slot, ...rest } = raw
    const input = memoryInput(rest)
    if (
      !['preference', 'goal'].includes(input.kind) ||
      input.content.length > 300 ||
      (input.kind === 'goal' && (!input.ttlDays || input.ttlDays > 90))
    ) {
      throw ErrorCode.MEMORY_EXTRACTION_INVALID()
    }
    return { ...input, slot }
  })
  if (new Set(result.map((row) => row.slot)).size !== result.length) {
    throw ErrorCode.MEMORY_EXTRACTION_INVALID()
  }
  return result
}
export async function extractMemories(
  provider: ChatProvider,
  job: MemoryJobRow,
  text: { text: string, createdAt: string },
  existing: unknown,
  configuration: ConfigurationSnapshot,
  signal: AbortSignal,
  save: () => Promise<void>,
) {
  const requests = (job.state.requests ||= {})
  const outputBudget = settingNumber(
    configuration,
    'ai.memory.extractionOutputTokens',
    4096,
  )
  const instructions = secureInstructions(
    settingText(
      configuration,
      'ai.prompt.memoryExtraction',
      memoryExtractionPrompt,
    ),
    configuration,
  )
  const inputBudget = contextInputBudget(provider.contextPolicy, outputBudget)
  const candidates: unknown[] = Array.isArray(existing) ? [...existing] : []
  const history = () => [
    {
      role: 'user' as const,
      content: JSON.stringify({ source: text, existing: candidates }),
    },
  ]
  while (
    candidates.length &&
    estimateInputTokens({ history: history(), tools: [schema], instructions }) >
    inputBudget
  ) {
    candidates.pop()
  }
  if (
    estimateInputTokens({ history: history(), tools: [schema], instructions }) >
    inputBudget
  ) {
    throw ErrorCode.CONTEXT_LIMIT(
      '当前消息超出记忆提取模型的输入预算，未生成记忆建议',
    )
  }
  return modelRequest(
    'memory_extract',
    {
      history: history(),
      instructions,
      tools: [schema],
      toolChoice: { type: 'function', name: 'memory_extract' },
      publicReasoning: false,
      outputTokenBudget: outputBudget,
      configuration,
      signal,
      localDate: '',
      onDelta() {},
      execution: {
        userId: job.userId,
        operationId: job.id,
        purpose: 'memory_extraction',
        agentId: 'memory',
        messageId: job.messageId,
      },
    },
    async (input) => {
      const controller = new AbortController()
      const abort = () => controller.abort(input.signal.reason)
      input.signal.addEventListener('abort', abort, { once: true })
      const timer = setTimeout(
        () => controller.abort('MEMORY_TIMEOUT'),
        settingNumber(configuration, 'ai.memory.extractionTimeoutMs', 60000),
      )
      try {
        input.signal.throwIfAborted()
        const result = await provider.next({
          ...input,
          signal: controller.signal,
        })
        if (
          result.calls.length !== 1 ||
          result.calls[0]?.name !== 'memory_extract'
        ) {
          throw ErrorCode.MEMORY_EXTRACTION_INVALID()
        }
        try {
          return extractionResult(JSON.parse(result.calls[0]!.arguments))
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error) {
            throw error
          }
          throw ErrorCode.MEMORY_EXTRACTION_INVALID()
        }
      } catch (error) {
        if (
          !input.signal.aborted &&
          controller.signal.reason === 'MEMORY_TIMEOUT'
        ) {
          throw new OpenAI.APIConnectionTimeoutError({})
        }
        throw error
      } finally {
        clearTimeout(timer)
        input.signal.removeEventListener('abort', abort)
      }
    },
    {
      records: requests,
      save,
      onRetry: async () => {},
      onUsage: async () => {},
    },
  )
}
