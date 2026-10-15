import type { ChatMessage, ChatServerEvent } from '@t-box/shared'
import type OpenAI from 'openai'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { definition } from '../src/agent/schema.js'
import { MessageTimeline } from '../src/agent/timeline.js'
import { generateConversationTitle } from '../src/agent/title.js'
import { ChatService } from '../src/chat/engine.js'
import { OpenAIResponsesProvider } from '../src/chat/provider.js'
import { MemorySessionRepository } from '../src/chat/session.js'

const wait = async (check: () => boolean) => {
  const end = Date.now() + 2000
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Missing event')
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}
test('reasoning, analysis, tool, reasoning and final answer keep chronological positions across streaming and completion', async (t) => {
  const module = {
    id: 'fixture',
    manifest: {
      id: 'fixture',
      name: 'fixture',
      description: 'fixture',
      icon: 'file' as const,
      color: 'blue' as const,
      version: '1',
      skillIds: ['fixture'],
    },
    skills: {
      fixture: {
        title: 'fixture',
        description: 'fixture',
        version: '1',
        tools: ['fixture_read'],
        instructions: 'fixture',
      },
    },
    tools: {
      fixture_read: {
        definition: definition('fixture_read', 'Read', {}),
        title: '读取记录',
        execution: 'server' as const,
        effect: 'read' as const,
        successSummary: '读取完成',
        handler: async () => ({ count: 1 }),
      },
    },
  }
  const registry = new CapabilityRegistry([
    module,
    createShellModule([module]),
  ])
  let round = 0
  const runtime = new ChatService({
    registry,
    provider: {
      mode: 'openai',
      async next(input) {
        const index = ++round
        input.onReasoning?.(`r${index}:0`, '先查看', true)
        input.onReasoning?.(`r${index}:0`, '记录', true)
        input.onDelta(index === 1 ? '查询记录' : '共有1条记录', `m${index}:0`)
        const calls =
          index === 1
            ? [{ id: 'read-one', name: 'fixture_read', arguments: '{}' }]
            : []
        return {
          calls,
          output: [
            {
              type: 'reasoning',
              id: `r${index}`,
              summary: [{ type: 'summary_text', text: '先查看记录' }],
              encrypted_content: 'PRIVATE_ENCRYPTED_REASONING',
            },
            {
              type: 'message',
              id: `m${index}`,
              role: 'assistant',
              status: 'completed',
              content: [
                {
                  type: 'output_text',
                  text: index === 1 ? '查询记录' : '共有1条记录',
                  annotations: [],
                },
              ],
            },
            ...calls.map((c) => ({
              type: 'function_call' as const,
              call_id: c.id,
              name: c.name,
              arguments: c.arguments,
            })),
          ],
        }
      },
    },
  })
  const events: ChatServerEvent[] = []
  const connection = runtime.connect((e) => events.push(structuredClone(e)))
  t.after(async () => {
    connection.close()
    await runtime.close()
  })
  await connection.receive({ type: 'session.open' })
  await connection.receive({
    type: 'message.send',
    requestId: 'ordered',
    text: '查记录',
    applicationIds: ['fixture'],
    localDate: '2026-10-06',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  const final = events.find((e) => e.type === 'run.finished')!
  assert.equal(final.status, 'completed', JSON.stringify(final.snapshot))
  const message = final.snapshot.messages.at(-1)!
  assert.deepEqual(
    message.timeline!.map((x) => x.kind),
    ['reasoning', 'analysis', 'tool', 'reasoning', 'answer'],
  )
  assert.deepEqual(
    message.timeline!.map((x) => x.sequence),
    [1, 2, 3, 4, 5],
  )
  const tool = message.timeline![2]!
  assert.equal(tool.kind === 'tool' && tool.tool.status, 'completed')
  assert.equal(message.outcome, 'completed')
  assert.ok(!JSON.stringify(events).includes('PRIVATE_ENCRYPTED_REASONING'))
  const firstTool = events.findIndex(
    (e) => e.type === 'timeline.update' && e.item.kind === 'tool',
  )
  assert.ok(
    events
      .slice(0, firstTool)
      .some((e) => e.type === 'timeline.delta' && e.delta === '记录'),
  )
  const toolUpdates = events.filter(
    (e) => e.type === 'timeline.update' && e.item.kind === 'tool',
  )
  assert.ok(toolUpdates.length >= 2)
  assert.ok(
    toolUpdates.every(
      (e) => e.type === 'timeline.update' && e.item.sequence === 3,
    ),
  )
})

test('Responses requests reasoning summaries only for opted-in models and streams public summary parts', async () => {
  const requests: Record<string, unknown>[] = []
  const summaries: string[] = []
  const client = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        requests.push(request)
        return (async function* () {
          yield {
            type: 'response.reasoning_summary_text.delta',
            item_id: 'r',
            summary_index: 0,
            delta: '公开摘要',
          }
          yield {
            type: 'response.reasoning_summary_text.done',
            item_id: 'r',
            summary_index: 0,
            text: '公开摘要',
          }
          yield { type: 'response.completed', response: { output: [] } }
        })()
      },
    },
  } as unknown as OpenAI
  for (const supportsReasoning of [false, true]) {
    await new OpenAIResponsesProvider(
      { apiKey: 'fixture', model: 'fixture', supportsReasoning },
      client,
    ).next({
      history: [],
      tools: [],
      signal: new AbortController().signal,
      onDelta() {},
      localDate: '2026-10-06',
      instructions: '',
      onReasoning(_id, text, delta) {
        summaries.push(`${delta}:${text}`)
      },
    })
  }
  assert.equal(requests[0]!.reasoning, undefined)
  assert.deepEqual(requests[1]!.reasoning, { summary: 'auto' })
  assert.deepEqual(summaries, [
    'true:公开摘要',
    'false:公开摘要',
    'true:公开摘要',
    'false:公开摘要',
  ])
})

test('interrupted progress stays marked and durable positions/revisions are reused after restoration', () => {
  const session = new MemorySessionRepository().create()
  const message: ChatMessage = {
    id: 'a',
    role: 'assistant',
    content: '',
    createdAt: 'now',
    toolCalls: [],
  }
  session.messages.push(message)
  const timeline = new MessageTimeline(session, 'run', message)
  timeline.text('first', 'reasoning', '公开摘要')
  timeline.tool({
    id: 'read',
    name: 'read',
    title: '读取',
    execution: 'server',
    status: 'running',
  })
  timeline.interrupt()
  assert.equal(
    message.timeline![0]!.kind !== 'tool' && message.timeline![0]!.status,
    'interrupted',
  )
  const restored = structuredClone(message)
  new MessageTimeline(session, 'run', restored).tool({
    id: 'read',
    name: 'read',
    title: '读取',
    execution: 'server',
    status: 'completed',
  })
  assert.equal(restored.timeline![1]!.sequence, 2)
  assert.equal(restored.timeline!.length, 2)
  assert.equal(restored.timeline![1]!.revision, 1)
})

test('optional title generation cannot overwrite a concurrent manual rename, execute tools, or fail the conversation', async () => {
  const session = new MemorySessionRepository().create()
  session.conversationId = 'fixture'
  session.messages = [
    {
      id: 'u',
      role: 'user',
      content: '整理旅行计划',
      createdAt: 'now',
      toolCalls: [],
    },
  ]
  let manual = false
  const actor = {
    user: { id: 'fixture' },
    sessionHash: 'fixture',
  } as Parameters<typeof generateConversationTitle>[2]
  const registry = new CapabilityRegistry([createShellModule([])])
  const provider = {
    mode: 'openai' as const,
    async next() {
      throw new Error('No tools/loop allowed')
    },
    async title() {
      manual = true
      return '旅行安排'
    },
  }
  const options = {
    registry,
    provider,
    host: {
      identity: {
        async authenticate() {
          return actor!
        },
        async authenticateHash() {
          return actor!
        },
      },
      conversations: {
        async save() {},
        async load() {},
        async restore() {},
        async exists() {
          return true
        },
        async needsTitle() {
          return true
        },
        async setGeneratedTitle() {
          return manual ? '我手动命名' : '旅行安排'
        },
      },
    },
  }
  await generateConversationTitle(
    options,
    session,
    actor,
    provider,
    new AbortController().signal,
  )
  assert.equal(session.title, '我手动命名')
  provider.title = async () => {
    throw new Error('Provider down')
  }
  await generateConversationTitle(
    options,
    session,
    actor,
    provider,
    new AbortController().signal,
  )
  assert.equal(session.title, '我手动命名')
})

test('exhausting public text budget still allows a bounded interruption notice and final cleanup', () => {
  const session = new MemorySessionRepository().create()
  const message: ChatMessage = {
    id: 'a',
    role: 'assistant',
    content: '',
    createdAt: 'now',
    toolCalls: [],
  }
  const timeline = new MessageTimeline(session, 'run', message)
  for (let i = 0; i < 5; i++) {
    timeline.text(`part-${i}`, 'analysis', 'x'.repeat(80_000), false)
  }
  assert.throws(
    () => timeline.text('overflow', 'analysis', 'extra', false),
    /limit/,
  )
  assert.doesNotThrow(() =>
    timeline.text('notice', 'notice', '模型输出已中断，请继续任务。', false),
  )
  assert.doesNotThrow(() => timeline.interrupt())
})
