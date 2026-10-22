import type { ProviderInput, ProviderItem } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import OpenAI from 'openai'
import { definition } from '../src/agent/schema.js'
import { OpenAIChatCompletionsProvider } from '../src/chat/chat-completions-provider.js'
import { chatMessages } from '../src/chat/chat-messages.js'
import { invocationMode } from '../src/chat/invocation-mode.js'
import { createConversationProvider } from '../src/chat/provider-factory.js'

const tool = definition('lookup', 'Lookup', { key: { type: 'string' } })
const input = (): ProviderInput => ({
  history: [{ role: 'user', content: '查询' }],
  instructions: 'test instructions',
  localDate: '2026-10-08',
  tools: [tool],
  toolChoice: { type: 'function', name: 'lookup' },
  signal: new AbortController().signal,
  onDelta() {},
})
const chunk = (delta: unknown, finish: string | null = null) => ({
  id: 'chat-test',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'test',
  choices: [{ index: 0, delta, finish_reason: finish }],
})
function fixture(events: unknown[]) {
  let body: any
  let path = ''
  const client = new OpenAI({
    apiKey: 'fixture',
    maxRetries: 0,
    fetch: async (url, init) => {
      path = String(url)
      body = JSON.parse(String(init?.body))
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('') +
        'data: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  const provider = new OpenAIChatCompletionsProvider(
    {
      apiKey: 'fixture',
      model: 'test',
      supportsReasoning: true,
      contextPolicy: {
        maxInputTokens: 32768,
        compaction: true,
        compactionMode: 'native',
        promptCacheKey: true,
        tokenCounting: true,
      },
    },
    client,
  )
  return { provider, request: () => ({ body, path }) }
}
test('Chat transport assembles indexed tool deltas, meters usage and keeps canonical output', async () => {
  const f = fixture([
    chunk({
      reasoning_content: 'private',
      content: '正在查询',
      tool_calls: [
        {
          index: 0,
          id: 'call-a',
          type: 'function',
          function: { name: 'lookup', arguments: '{"key":' },
        },
        {
          index: 1,
          id: 'call-b',
          type: 'function',
          function: { name: 'lookup', arguments: '{"key":"b"}' },
        },
      ],
    }),
    chunk(
      { tool_calls: [{ index: 0, function: { arguments: '"a"}' } }] },
      'tool_calls',
    ),
    {
      id: 'chat-test',
      choices: [],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 30,
        total_tokens: 130,
        prompt_tokens_details: { cached_tokens: 50 },
        completion_tokens_details: { reasoning_tokens: 20 },
      },
    },
  ])
  const args = input()
  let text = ''
  let reasoning = false
  const usages: any[] = []
  args.onDelta = (d) => {
    text += d
  }
  args.onReasoning = () => {
    reasoning = true
  }
  args.onUsage = async (u) => {
    usages.push(u)
  }
  args.execution = { userId: 'user', operationId: 'op' }
  const turn = await f.provider.next(args)
  assert.equal(text, '正在查询')
  assert.equal(reasoning, false)
  assert.deepEqual(turn.calls, [
    { id: 'call-a', name: 'lookup', arguments: '{"key":"a"}' },
    { id: 'call-b', name: 'lookup', arguments: '{"key":"b"}' },
  ])
  assert.equal(usages.length, 1)
  assert.equal(usages[0].cachedInputTokens, 50)
  assert.equal(usages[0].reasoningTokens, 20)
  const { body, path } = f.request()
  assert.match(path, /\/chat\/completions$/)
  assert.equal(body.max_completion_tokens, 32768)
  assert.equal(body.stream_options.include_usage, true)
  assert.deepEqual(body.tool_choice, {
    type: 'function',
    function: { name: 'lookup' },
  })
  assert.equal(body.tools[0].function.name, 'lookup')
  assert.equal(body.prompt_cache_key.length, 64)
  assert.equal(body.reasoning, undefined)
  assert.equal(body.include, undefined)
  assert.equal(f.provider.contextPolicy.tokenCounting, false)
  assert.equal(f.provider.contextPolicy.compactionMode, 'summary')
  const history: ProviderItem[] = [
    ...args.history,
    ...turn.output,
    { type: 'function_call_output', call_id: 'call-b', output: 'B' },
    { type: 'function_call_output', call_id: 'call-a', output: 'A' },
  ]
  const messages = chatMessages(history, 'test')
  assert.equal(messages[2]?.role, 'assistant')
  assert.equal((messages[2] as any).tool_calls.length, 2)
  assert.equal(messages[3]?.role, 'tool')
  assert.equal((messages[3] as any).tool_call_id, 'call-b')
})
test('portable history carries image input, refuses orphan calls and opaque native memory', () => {
  const image: ProviderItem = {
    role: 'user',
    content: [
      { type: 'input_text', text: '这是什么' },
      {
        type: 'input_image',
        image_url: 'data:image/png;base64,AA==',
        detail: 'auto',
      },
    ],
  }
  assert.equal(
    (chatMessages([image], 'test', true)[1] as any).content[1].image_url.url,
    'data:image/png;base64,AA==',
  )
  assert.throws(() => chatMessages([image], 'test', false), {
    code: 'VISION_MODEL_REQUIRED',
  })
  assert.throws(
    () =>
      chatMessages(
        [{ type: 'function_call_output', call_id: 'orphan', output: 'x' }],
        'test',
      ),
    { code: 'CHAT_HISTORY_INVALID' },
  )
  assert.throws(
    () =>
      chatMessages(
        [
          {
            type: 'function_call',
            call_id: 'pending',
            name: 'lookup',
            arguments: '{}',
          },
        ],
        'test',
      ),
    { code: 'CHAT_HISTORY_INVALID' },
  )
  assert.throws(
    () =>
      chatMessages(
        [{ type: 'compaction', encrypted_content: 'opaque' }],
        'test',
      ),
    { code: 'CHAT_HISTORY_INVALID' },
  )
})
test('incomplete stream never dispatches partial tools and preserves reported usage', async () => {
  const f = fixture([
    chunk(
      {
        tool_calls: [
          {
            index: 0,
            id: 'a',
            type: 'function',
            function: { name: 'lookup', arguments: '{"key":' },
          },
        ],
      },
      'length',
    ),
    {
      id: 'chat-test',
      choices: [],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    },
  ])
  let billed = 0
  const args = input()
  args.onUsage = async () => {
    billed++
  }
  await assert.rejects(f.provider.next(args), { code: 'PROVIDER_INCOMPLETE' })
  assert.equal(billed, 1)
  await assert.rejects(
    fixture([chunk({ content: 'partial' })]).provider.next(input()),
    { code: 'PROVIDER_STREAM_CLOSED' },
  )
  await assert.rejects(
    fixture([
      chunk(
        {
          tool_calls: [
            { index: 0, function: { name: 'lookup', arguments: '{}' } },
          ],
        },
        'tool_calls',
      ),
    ]).provider.next(input()),
    { code: 'PROVIDER_FAILED' },
  )
})
test('summary and title use Chat transport without tools; purposes cannot cross modes', async () => {
  const f = fixture([chunk({ content: '主题摘要' }, 'stop')])
  assert.equal(await f.provider.summarize(input()), '主题摘要')
  assert.equal(f.request().body.tools, undefined)
  assert.equal(
    await f.provider.title({
      text: '你好',
      signal: new AbortController().signal,
    }),
    '主题摘要',
  )
  assert.equal(f.request().body.max_completion_tokens, 1024)
  assert.equal(invocationMode(undefined, 'conversation'), 'responses')
  assert.equal(invocationMode(undefined, 'image'), 'images')
  assert.throws(() => invocationMode('images', 'conversation'))
  assert.throws(() => invocationMode(['responses'], 'conversation'))
  assert.throws(() => invocationMode('chat_completions', 'image'))
  assert.throws(
    () =>
      createConversationProvider({
        apiKey: 'x',
        model: 'test',
        invocationMode: 'images',
      }),
    { code: 'INVALID_INVOCATION_MODE' },
  )
})
test('terminal usage envelopes may have a gateway ID but content from different completions is rejected', async () => {
  let usageId = ''
  const args = input()
  args.onUsage = async (usage) => {
    usageId = usage.responseId
  }
  const result = await fixture([
    chunk({ content: '完成' }, 'stop'),
    { id: 'gateway-usage-id', choices: [], usage: { prompt_tokens: 100, completion_tokens: 4, total_tokens: 104 } },
  ]).provider.next(args)
  assert.equal(usageId, 'chat-test')
  assert.equal(result.calls.length, 0)
  await assert.rejects(fixture([
    chunk({ content: '首段' }),
    { ...chunk({ content: '混入其他响应' }, 'stop'), id: 'another-completion' },
  ]).provider.next(input()), { code: 'PROVIDER_FAILED' })
  await assert.rejects(fixture([
    chunk({ content: '首段' }),
    { id: 'premature-usage', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  ]).provider.next(input()), { code: 'PROVIDER_FAILED' })
})
