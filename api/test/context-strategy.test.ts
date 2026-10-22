import type OpenAI from 'openai'
import type { ContextState } from '../src/agent/context.js'
import type { ChatProvider, ProviderInput, ProviderItem } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { contextPolicy } from '../src/admin/context-policy.js'
import {
  contextUnits,
  estimateInputTokens,
  prepareContext,
} from '../src/agent/context.js'
import {
  OpenAIResponsesProvider,
} from '../src/chat/provider.js'
import { restoreContextReferences } from '../src/resources/context.js'

const input = (history: ProviderItem[] = []): ProviderInput => ({
  history,
  tools: [],
  instructions: '当前系统规则',
  signal: new AbortController().signal,
  localDate: '2026-10-07',
  onDelta() {},
})
const history = (turns = 20): ProviderItem[] =>
  Array.from({ length: turns }, (_, i) => [
    { role: 'user' as const, content: `用户请求 ${i}：${'事实'.repeat(500)}` },
    { role: 'assistant' as const, content: `答复 ${i}：${'记录'.repeat(500)}` },
  ]).flat()
const provider = (overrides: Partial<ChatProvider> = {}): ChatProvider => ({
  mode: 'openai',
  maxOutputTokens: 8192,
  contextPolicy: contextPolicy({
    maxInputTokens: 32768,
    compaction: false,
    promptCacheKey: false,
  }),
  async summarize() {
    return '## 事实\n用户想查询记录，已完成的操作需要以真实执行回执为准。'
  },
  async next() {
    throw new Error('unused')
  },
  ...overrides,
})
test('normalization upgrades legacy disabled native capability to portable summaries; explicit off persists', () => {
  assert.equal(contextPolicy(null).maxInputTokens, 98304)
  assert.equal(
    contextPolicy({
      maxInputTokens: 32768,
      compaction: false,
      promptCacheKey: false,
    }).compactionMode,
    'summary',
  )
  assert.equal(
    contextPolicy({
      maxInputTokens: 32768,
      compaction: true,
      promptCacheKey: false,
    }).compactionMode,
    'native',
  )
  assert.equal(
    contextPolicy({ ...contextPolicy(null), compactionMode: 'off' }).compaction,
    false,
  )
  for (const value of [
    { ...contextPolicy(null), foo: true },
    { ...contextPolicy(null), compactionThreshold: NaN },
    { ...contextPolicy(null), maxOutputTokens: -1 },
    {
      ...contextPolicy(null),
      contextWindowTokens: 32768,
      maxOutputTokens: 32768,
    },
    { ...contextPolicy(null), keepRecentTurns: 0 },
  ]) {
    assert.throws(() => contextPolicy(value, true), {
      code: 'INVALID_CONTEXT_POLICY',
    })
  }
})
test('portable summaries keep latest four turns verbatim, chunk within budgets and preserve original history', async () => {
  const original = history()
  const copy = structuredClone(original)
  const calls: ProviderInput[] = []
  const progress: string[] = []
  const state: ContextState = {}
  const result = await prepareContext(
    provider({
      async summarize(request) {
        calls.push(request)
        return '用户目标和已完成操作的事实记忆。'
      },
    }),
    input(original),
    {
      state,
      onProgress: async (p) => {
        progress.push(p.phase)
      },
    },
  )
  assert.equal(result.compacted, true)
  assert.deepEqual(original, copy)
  assert.deepEqual(result.history.slice(1), original.slice(-8))
  assert.ok(calls.length > 1)
  assert.ok(calls.every((c) => estimateInputTokens(c) <= 32768))
  assert.ok(
    calls.every(
      (c) =>
        !c.tools.length &&
        c.toolChoice === 'none' &&
        c.publicReasoning === false,
    ),
  )
  assert.equal(state.compactions, 1)
  assert.equal(state.countingVersion, 'cl100k-v1')
  assert.equal(progress[0], 'start')
  assert.equal(progress.at(-1), 'completed')
  const again = await prepareContext(provider(), input(result.history), {
    state,
  })
  assert.equal(again.compacted, false)
})
test('in-flight compaction pins latest request and keeps parallel tool calls with all outputs', async () => {
  const items: ProviderItem[] = [
    { role: 'user', content: '生成一个图片，不能重复生成' },
  ]
  for (let i = 0; i < 16; i++) {
    items.push(
      {
        type: 'reasoning',
        id: `r${i}`,
        summary: [],
        encrypted_content: 'OPAQUE_PRIVATE_REASONING',
      },
      {
        type: 'function_call',
        call_id: `a${i}`,
        name: 'read',
        arguments: '{}',
      },
      {
        type: 'function_call',
        call_id: `b${i}`,
        name: 'read',
        arguments: '{}',
      },
      {
        type: 'function_call_output',
        call_id: `a${i}`,
        output: `事实${'数据记录'.repeat(700)}`,
      },
      {
        type: 'function_call_output',
        call_id: `b${i}`,
        output: `resource_id=${i};${'数据记录'.repeat(700)}`,
      },
    )
  }
  const requests: ProviderInput[] = []
  const result = await prepareContext(
    provider({
      async summarize(c) {
        requests.push(c)
        return '只查询了事实，尚未生成图片。'
      },
    }),
    input(items),
  )
  assert.equal(result.compacted, true)
  assert.deepEqual(result.history[1], items[0])
  assert.doesNotThrow(() => contextUnits(result.history))
  assert.ok(
    requests.every(
      (c) => !JSON.stringify(c.history).includes('OPAQUE_PRIVATE_REASONING'),
    ),
  )
  assert.ok(
    requests.some((c) => JSON.stringify(c.history).includes('resource_id=')),
  )
  assert.ok(
    result.history.some(
      (c) => c.type === 'function_call' && c.call_id === 'a15',
    ),
  )
})
test('failed later summary chunk leaves context and compaction state untouched', async () => {
  const original = history()
  const copy = structuredClone(original)
  const state: ContextState = { compactions: 2 }
  let n = 0
  await assert.rejects(
    prepareContext(
      provider({
        async summarize() {
          if (++n === 2) {
            throw new Error('fixture timeout')
          }
          return '第一段事实'
        },
      }),
      input(original),
      { state },
    ),
    /timeout/,
  )
  assert.ok(n >= 2)
  assert.deepEqual(original, copy)
  assert.deepEqual(state, { compactions: 2 })
})
test('pending or orphaned tool batches never invoke the summary model', async () => {
  let n = 0
  const p = provider({
    async summarize() {
      n++
      return 'unused'
    },
  })
  for (const partial of [
    {
      type: 'function_call' as const,
      call_id: 'pending',
      name: 'write',
      arguments: '{}',
    },
    { type: 'function_call_output' as const, call_id: 'orphan', output: '{}' },
  ]) {
    await assert.rejects(prepareContext(p, input([...history(), partial])), {
      code: 'CONTEXT_TOOL_PENDING',
    })
  }
  assert.equal(n, 0)
})
test('oversized latest user input and a single atomic receipt fail explicitly instead of truncating', async () => {
  let n = 0
  const p = provider({
    async summarize() {
      n++
      return 'unused'
    },
  })
  await assert.rejects(
    prepareContext(
      p,
      input([...history(), { role: 'user', content: '测'.repeat(33000) }]),
    ),
    { code: 'CONTEXT_LATEST_TOO_LARGE' },
  )
  await assert.rejects(
    prepareContext(
      p,
      input([
        { role: 'user', content: '第一轮' },
        {
          type: 'function_call',
          call_id: 'big',
          name: 'read',
          arguments: '{}',
        },
        {
          type: 'function_call_output',
          call_id: 'big',
          output: '测'.repeat(33000),
        },
        { role: 'user', content: '第二轮' },
      ]),
    ),
    { code: 'CONTEXT_ITEM_TOO_LARGE' },
  )
  assert.equal(n, 0)
})
test('summary inputs strip image bytes while retaining resource IDs; retained images restore private references', async () => {
  const original = history()
  original[0] = {
    role: 'user',
    content: [
      { type: 'input_text', text: '附件 resource-old 图片' },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,SECRET_PIXELS',
        detail: 'auto',
      },
    ],
  }
  original.push({
    role: 'user',
    content: [
      { type: 'input_text', text: '新附件 resource-latest' },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,NEW_PIXELS',
        detail: 'auto',
      },
    ],
  })
  const requests: ProviderInput[] = []
  const result = await prepareContext(
    provider({
      async summarize(c) {
        requests.push(c)
        return '用户提供 resource-old，目标待处理。'
      },
    }),
    input(original),
  )
  assert.ok(
    requests.every((c) => !JSON.stringify(c.history).includes('SECRET_PIXELS')),
  )
  assert.ok(
    requests.some((c) => JSON.stringify(c.history).includes('resource-old')),
  )
  const durable = structuredClone(original)
  const last = durable.at(-1)!
  if (
    'content' in last &&
    Array.isArray(last.content) &&
    last.content[1]?.type === 'input_image'
  ) {
    last.content[1].image_url = 'asset:resource-latest'
  }
  const restored = restoreContextReferences(durable, original, result.history)
  assert.ok(JSON.stringify(restored).includes('asset:resource-latest'))
  assert.ok(!JSON.stringify(restored).includes('NEW_PIXELS'))
})
test('window subtracts output budget and margin; exact count capability overrides conservative admission estimate', async () => {
  const p = provider({
    contextPolicy: {
      ...contextPolicy(null),
      maxInputTokens: 98304,
      contextWindowTokens: 40000,
      maxOutputTokens: 32768,
    },
    maxOutputTokens: 32768,
  })
  await assert.rejects(prepareContext(p, input([])), {
    code: 'CONTEXT_BUDGET_INVALID',
  })
  let counts = 0
  const exact = provider({
    contextPolicy: { ...contextPolicy(null), tokenCounting: true },
    async countInputTokens() {
      counts++
      return 1000
    },
  })
  const original = history(100)
  assert.equal((await prepareContext(exact, input(original))).compacted, false)
  assert.equal(counts, 1)
})
test('hysteresis skips small schema growth but hard input budget always wins', async () => {
  const p = provider({
    contextPolicy: {
      ...contextPolicy(null),
      maxInputTokens: 32768,
      tokenCounting: true,
    },
    async countInputTokens() {
      return 26000
    },
  })
  assert.equal(
    (
      await prepareContext(p, input(history()), {
        state: { lastAfterTokens: 25000 },
      })
    ).compacted,
    false,
  )
  const off = provider({
    contextPolicy: {
      ...contextPolicy(null),
      maxInputTokens: 32768,
      compactionMode: 'off',
      tokenCounting: true,
    },
    async countInputTokens() {
      return 33000
    },
  })
  await assert.rejects(
    prepareContext(off, input(history()), {
      state: { lastAfterTokens: 32000 },
    }),
    { code: 'CONTEXT_LIMIT' },
  )
})
test('local compaction hysteresis never compares legacy byte counts with token counts', async () => {
  const original = history()
  const counted = estimateInputTokens(input(original))
  const p = provider({ contextPolicy: { ...contextPolicy(null), maxInputTokens: Math.ceil(counted / 0.85) } })
  const current: ContextState = { lastAfterTokens: counted, countingVersion: 'cl100k-v1' }
  assert.equal((await prepareContext(p, input(original), { state: current })).compacted, false)
  const legacy: ContextState = { lastAfterTokens: counted }
  assert.equal((await prepareContext(p, input(original), { state: legacy })).compacted, true)
  assert.equal(legacy.countingVersion, 'cl100k-v1')
})
test('opaque native memory is not exposed to a portable summarizer', async () => {
  await assert.rejects(
    prepareContext(
      provider(),
      input([
        { type: 'compaction', encrypted_content: 'PRIVATE' },
        ...history(),
      ]),
    ),
    { code: 'CONTEXT_OPAQUE' },
  )
})
test('reasoning output defaults to 32768, supports explicit budgets; summarization never enables tools or public reasoning', async () => {
  const bodies: Record<string, unknown>[] = []
  const client = {
    responses: {
      async create(body: Record<string, unknown>) {
        bodies.push(body)
        return (async function* () {
          yield {
            type: 'response.completed',
            response: {
              id: 'r',
              output: [
                {
                  role: 'assistant',
                  content: [{ type: 'output_text', text: '事实摘要' }],
                },
              ],
            },
          }
        })()
      },
      inputTokens: {
        async count() {
          return { input_tokens: 123 }
        },
      },
    },
  } as unknown as OpenAI
  const reasoning = new OpenAIResponsesProvider(
    { apiKey: 'fixture', model: 'fixture', supportsReasoning: true },
    client,
  )
  assert.equal(reasoning.maxOutputTokens, 32768)
  await reasoning.summarize(input([{ role: 'user', content: 'history' }]))
  assert.equal(bodies[0]!.max_output_tokens, 32768)
  assert.equal(bodies[0]!.tool_choice, 'none')
  assert.equal(bodies[0]!.reasoning, undefined)
  assert.equal(await reasoning.countInputTokens(input([])), 123)
  const configured = new OpenAIResponsesProvider(
    {
      apiKey: 'fixture',
      model: 'fixture',
      supportsReasoning: true,
      contextPolicy: { ...contextPolicy(null), maxOutputTokens: 65536 },
    },
    client,
  )
  assert.equal(configured.maxOutputTokens, 65536)
})

test('marked receipt projection bounds repeated instructions while authoritative records remain full', async () => {
  const { receiptEvidence } = await import('../src/agent/evidence.js')
  const result = {
    ok: true as const,
    data: { id: 'resource-actual', text: '详细数据'.repeat(6000) },
  }
  const preview = receiptEvidence(result) as {
    ok: boolean
    truncated: boolean
    preview: string
  }
  assert.equal(preview.ok, true)
  assert.equal(preview.truncated, true)
  assert.match(preview.preview, /resource-actual/)
  assert.ok(JSON.stringify(preview).length < 2000)
  assert.equal(result.data.text.length, 24000)
})
test('restoring portable history preserves structured tool outcomes, resources and attachment rehydration', async () => {
  const { rebuildConversationHistory } =
    await import('../src/agent/history.js')
  const { CapabilityRegistry } = await import('../src/agent/registry.js')
  const { MemorySessionRepository } = await import('../src/chat/session.js')
  const session = new MemorySessionRepository().create()
  session.messages = [
    {
      id: 'u',
      role: 'user',
      content: '处理附件',
      createdAt: 'now',
      toolCalls: [],
      attachments: [{ id: 'asset-id', name: '附件' } as any],
    },
    {
      id: 'a',
      role: 'assistant',
      content: '已生成图片',
      createdAt: 'now',
      toolCalls: [
        {
          id: 'c',
          name: 'images_generate',
          title: '生图',
          execution: 'server',
          status: 'completed',
        },
      ],
    },
  ]
  session.calls.set('c', {
    fingerprint: 'images_generate:{"prompt":"猫"}',
    result: { ok: true, data: { resourceId: 'actual-resource' } },
  })
  let appended = 0
  const rebuilt = rebuildConversationHistory(
    session,
    new CapabilityRegistry([]),
    {
      append() {
        appended++
      },
      async modelHistory(_a, h) {
        return h
      },
      async attachments() {
        return []
      },
    },
  )
  assert.equal(appended, 1)
  assert.ok(JSON.stringify(rebuilt).includes('actual-resource'))
  assert.ok(
    rebuilt.some(
      (x) => x.type === 'function_call' && x.arguments.includes('猫'),
    ),
  )
  assert.doesNotThrow(() => contextUnits(rebuilt))
})

test('a failed completion persistence callback cannot commit compaction state', async () => {
  const state: ContextState = { compactions: 3, lastAfterTokens: 10000 }
  const original = history()
  const copy = structuredClone(original)
  await assert.rejects(
    prepareContext(provider(), input(original), {
      state,
      onProgress: async (p) => {
        if (p.phase === 'completed') {
          throw new Error('fixture save failed')
        }
      },
    }),
    /save failed/,
  )
  assert.deepEqual(state, { compactions: 3, lastAfterTokens: 10000 })
  assert.deepEqual(original, copy)
})
