import type OpenAI from 'openai'
import type { ChatProvider, ProviderInput, ProviderUsage } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { estimateInputTokens, prepareContext } from '../src/agent/context.js'
import {
  OpenAIResponsesProvider,
} from '../src/chat/provider.js'

const input = (): ProviderInput => ({
  history: [{ role: 'user', content: '你好' }],
  tools: [],
  signal: new AbortController().signal,
  onDelta() {},
  localDate: '2026-10-06',
  instructions: 'safe',
})
test('usage preserves cached/reasoning subsets; stable cache key is server derived', async () => {
  let sent: Record<string, unknown> = {}
  let usage: ProviderUsage | undefined
  const client = {
    responses: {
      async create(body: Record<string, unknown>) {
        sent = body
        return (async function* () {
          yield {
            type: 'response.completed',
            response: {
              id: 'resp_usage',
              output: [],
              usage: {
                input_tokens: 100,
                output_tokens: 20,
                total_tokens: 120,
                input_tokens_details: {
                  cached_tokens: 60,
                  cache_write_tokens: 20,
                },
                output_tokens_details: { reasoning_tokens: 10 },
              },
            },
          }
        })()
      },
    },
  } as unknown as OpenAI
  const provider = new OpenAIResponsesProvider(
    {
      apiKey: 'fixture',
      model: 'fixture',
      contextPolicy: {
        maxInputTokens: 32768,
        compaction: false,
        promptCacheKey: true,
      },
    },
    client,
  )
  await provider.next({
    ...input(),
    execution: { userId: 'u1', agentId: 'a1', operationId: 'o1' },
    onUsage: async (u) => {
      usage = u
    },
  })
  assert.equal(usage?.inputTokens, 100)
  assert.equal(usage?.outputTokens, 20)
  assert.equal(usage?.cachedInputTokens, 60)
  assert.equal(usage?.reasoningTokens, 10)
  assert.equal(
    sent.prompt_cache_key,
    createHash('sha256').update('tbox:u1:a1').digest('hex'),
  )
  assert.equal(usage!.cacheWriteTokens, 20)
  assert.equal(usage!.inputTokens + usage!.outputTokens, 120)
})
test('context refuses silent truncation and compacts only complete tool pairs', async () => {
  const big = {
    ...input(),
    history: [{ role: 'user' as const, content: '测'.repeat(18000) }],
  }
  const provider: ChatProvider = {
    mode: 'openai',
    contextPolicy: {
      maxInputTokens: 8192,
      compaction: false,
      promptCacheKey: false,
    },
    async next() {
      throw new Error('unused')
    },
  }
  await assert.rejects(prepareContext(provider, big), {
    code: 'CONTEXT_LIMIT',
  })
  provider.contextPolicy!.compaction = true
  let calls = 0
  provider.compact = async () => {
    calls++
    return [{ type: 'compaction', encrypted_content: 'encrypted-fixture' }]
  }
  const pending = {
    ...big,
    history: [
      ...big.history,
      {
        type: 'function_call' as const,
        call_id: 'c',
        name: 'tool',
        arguments: '{}',
      },
    ],
  }
  await assert.rejects(prepareContext(provider, pending), {
    code: 'CONTEXT_TOOL_PENDING',
  })
  assert.equal(calls, 0)
  const complete = {
    ...pending,
    history: [
      ...pending.history,
      {
        type: 'function_call_output' as const,
        call_id: 'c',
        output: '{"ok":true}',
      },
    ],
  }
  const result = await prepareContext(provider, complete)
  assert.equal(result.compacted, true)
  assert.equal(calls, 1)
  assert.equal(
    complete.history.length,
    3,
    'projection never mutates durable history before commit',
  )
})
test('base64 encoding is not counted as text tokens', () => {
  const picture = (size: number) => ({
    ...input(),
    history: [
      {
        role: 'user' as const,
        content: [
          {
            type: 'input_image' as const,
            image_url: `data:image/png;base64,${'A'.repeat(size)}`,
            detail: 'auto' as const,
          },
        ],
      },
    ],
  })
  assert.equal(
    estimateInputTokens(picture(100)),
    estimateInputTokens(picture(1000000)),
  )
})

test('compaction restores attachment references and never checkpoints base64 projections', async () => {
  const { restoreContextReferences } =
    await import('../src/resources/context.js')
  const original: ProviderInput['history'] = [
    {
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'asset:fixture', detail: 'auto' },
      ],
    },
  ]
  const prepared: ProviderInput['history'] = [
    {
      role: 'user',
      content: [
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,AAAA',
          detail: 'auto',
        },
      ],
    },
  ]
  const restored = restoreContextReferences(original, prepared, [
    { type: 'compaction', encrypted_content: 'opaque' },
    ...prepared,
  ])
  assert(JSON.stringify(restored).includes('asset:fixture'))
  assert(!JSON.stringify(restored).includes('base64'))
  assert.throws(
    () =>
      restoreContextReferences(original, prepared, [
        {
          role: 'user',
          content: [
            {
              type: 'input_image',
              image_url: 'data:image/png;base64,BBBB',
              detail: 'auto',
            },
          ],
        },
      ]),
    { code: 'COMPACTION_ATTACHMENT_INVALID' },
  )
})

test('opted-in Responses compaction preserves opaque state and records actual usage', async () => {
  let sent: Record<string, unknown> | undefined
  let usage: ProviderUsage | undefined
  const client = {
    responses: {
      async compact(body: Record<string, unknown>) {
        sent = body
        return {
          id: 'compact-fixture',
          output: [{ type: 'compaction', encrypted_content: 'opaque-state' }],
          usage: {
            input_tokens: 12000,
            output_tokens: 2000,
            input_tokens_details: { cached_tokens: 10000 },
            output_tokens_details: { reasoning_tokens: 1000 },
          },
        }
      },
    },
  } as unknown as OpenAI
  const provider = new OpenAIResponsesProvider(
    {
      model: 'fixture',
      apiKey: 'fixture',
      contextPolicy: {
        maxInputTokens: 32768,
        compaction: true,
        promptCacheKey: false,
      },
    },
    client,
  )
  const projected = await provider.compact({
    ...input(),
    onUsage: async (v) => {
      usage = v
    },
  })
  assert.equal(sent!.model, 'fixture')
  assert.equal(projected[0]!.type, 'compaction')
  assert.equal(usage!.inputTokens, 12000)
  assert.equal(usage!.cachedInputTokens, 10000)
  assert.equal(usage!.reasoningTokens, 1000)
})
