import type { ChatServerEvent } from '@t-box/shared'
import type OpenAI from 'openai'
import type { RunCheckpoint } from '../src/agent/checkpoint.js'
import type { ApplicationModule } from '../src/agent/contracts.js'
import type { ProviderInput, ProviderTurn } from '../src/chat/provider.js'
import assert from 'node:assert/strict'
import test from 'node:test'
import { parseWorkflowPrompts } from '../src/agent-workflow/configuration.js'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { createShellModule } from '../src/agent/builtins.js'
import { CapabilityRegistry } from '../src/agent/registry.js'
import { runConversation } from '../src/agent/runner.js'
import { definition } from '../src/agent/schema.js'
import { readPlan, readReview } from '../src/agent/workflow.js'
import { ChatService } from '../src/chat/engine.js'
import { publicRunError } from '../src/chat/errors.js'
import {
  OpenAIResponsesProvider,
} from '../src/chat/provider.js'
import { MemorySessionRepository } from '../src/chat/session.js'

const config = {
  revision: 1,
  prompts: defaultWorkflowPrompts,
  updatedAt: new Date().toISOString(),
}
const call = (name: string, args: unknown, id = name): ProviderTurn => ({
  calls: [{ id, name, arguments: JSON.stringify(args) }],
  output: [
    {
      type: 'function_call',
      call_id: id,
      name,
      arguments: JSON.stringify(args),
    },
  ],
})
const say = (input: ProviderInput, text: string): ProviderTurn => {
  input.onDelta(text)
  return { calls: [], output: [{ role: 'assistant', content: text }] }
}
const wait = async (check: () => boolean) => {
  const until = Date.now() + 3000
  while (!check()) {
    if (Date.now() > until) {
      throw new Error('Missing finish')
    }
    await new Promise((r) => setTimeout(r, 2))
  }
}
const plan = (route = 'execute', tools: string[] = []) => ({
  route,
  summary: '先核对需求，按授权使用应用能力。',
  steps: route === 'execute' ? ['执行所需工具'] : [],
  requiredTools: tools,
})
const review = (action = 'complete', next = '') => ({
  action,
  summary: '已核对实际回执。',
  next,
})
function fixture(receipt = false) {
  let runs = 0
  const module: ApplicationModule = {
    id: 'pictures',
    skills: {
      image_creation: {
        title: '资源创作',
        description: '按用户要求生成图片，读取图片不是生成',
        version: '1',
        tools: ['images_generate'],
        instructions: '只按明确要求生成，不能编造结果。',
      },
    },
    tools: {
      images_generate: {
        definition: definition('images_generate', '真正生成图片', {}),
        title: '生成图片',
        execution: 'server',
        effect: 'external',
        successSummary: '图片已生成',
        ...(receipt
          ? {
              completionSummary: (
                result: import('@t-box/shared').ToolResult,
              ) =>
                result.ok &&
                (result.data as { resourceId?: string })?.resourceId
                  ? '图片已生成。'
                  : undefined,
            }
          : {}),
        writeFingerprint: JSON.stringify,
        handler: async () => ({ resourceId: `resource-${++runs}` }),
      },
    },
  }
  return {
    registry: new CapabilityRegistry([module, createShellModule([module])]),
    runs: () => runs,
  }
}
test('single-operation receipt route publishes a final answer immediately after the real tool result', async (t) => {
  const f = fixture(true)
  const events: ChatServerEvent[] = []
  let calls = 0
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next(input) {
        switch (calls++) {
          case 0:
            assert.match(input.instructions, /"receiptCompletion":true/)
            return call('workflow_plan', {
              ...plan('execute', ['images_generate']),
              verification: 'receipt',
            })
          case 1:
            return call('skill_activate', { skillId: 'image_creation' })
          case 2:
            return call('images_generate', {})
          default:
            throw Object.assign(
              new Error('Extra review/finalization must not be requested'),
              { status: 400 },
            )
        }
      },
    },
  })
  const connection = service.connect((event) =>
    events.push(structuredClone(event)),
  )
  t.after(async () => {
    connection.close()
    await service.close()
  })
  await connection.receive({ type: 'session.open' })
  await connection.receive({
    type: 'message.send',
    requestId: 'receipt',
    text: '生成一张图片',
    localDate: '2026-10-08',
  })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  const end = events.find((event) => event.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(end.status, 'completed')
  assert.equal(calls, 3)
  assert.equal(f.runs(), 1)
  assert.equal(end.snapshot.messages.at(-1)!.content, '图片已生成。')
  assert.equal(end.snapshot.messages.at(-1)!.timeline!.at(-1)!.kind, 'answer')
})

test('a model review failure preserves a completed result and names the unfinished stage', async (t) => {
  const f = fixture()
  const events: ChatServerEvent[] = []
  let n = 0
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next(input) {
        switch (n++) {
          case 0:
            return call('workflow_plan', plan('execute', ['images_generate']))
          case 1:
            return call('skill_activate', { skillId: 'image_creation' })
          case 2:
            return call('images_generate', {})
          case 3:
            return say(input, '图片工具已返回结果。')
          default:
            throw Object.assign(new Error('secret upstream body'), {
              status: 400,
            })
        }
      },
    },
  })
  const connection = service.connect((event) =>
    events.push(structuredClone(event)),
  )
  t.after(async () => {
    connection.close()
    await service.close()
  })
  await connection.receive({ type: 'session.open' })
  await connection.receive({
    type: 'message.send',
    requestId: 'review-failure',
    text: '生成一张图并解释构图',
    localDate: '2026-10-08',
  })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  const end = events.find((event) => event.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  const message = end.snapshot.messages.at(-1)!
  assert.equal(end.status, 'failed')
  assert.equal(f.runs(), 1)
  assert.equal(
    message.toolCalls.find((tool) => tool.name === 'images_generate')!.status,
    'completed',
  )
  assert.match(
    message.content,
    /图片已生成.*结果已保留.*会话结果核对失败.*400/,
  )
  assert.ok(!JSON.stringify(end).includes('secret upstream body'))
})
test('semantic plan drives tools, then reviews actual outcomes; stream order and all phase usage are preserved', async (t) => {
  const f = fixture()
  const events: ChatServerEvent[] = []
  let n = 0
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next(input) {
        await input.onUsage?.({
          inputTokens: 10,
          outputTokens: 2,
          responseId: `resp-${n}`,
        })
        input.onReasoning?.('private', 'must not be public', true)
        switch (n++) {
          case 0:
            assert.equal(input.toolChoice, 'auto')
            assert.deepEqual(
              input.tools.map((tool) => tool.name),
              ['workflow_plan'],
            )
            assert.match(input.instructions, /images_generate/)
            input.onDelta('我会按你的描述生成图片。')
            return call('workflow_plan', plan('execute', ['images_generate']))
          case 1:
            return call('skill_activate', { skillId: 'image_creation' })
          case 2:
            assert.ok(input.tools.some((t) => t.name === 'images_generate'))
            return call('images_generate', {})
          case 3:
            return say(input, '图片工具已返回结果。')
          case 4:
            assert.match(input.instructions, /resource-1/)
            assert.equal(input.tools.length, 1)
            return call('workflow_review', review())
          default:
            assert.equal(input.toolChoice, 'none')
            return say(input, '图片已生成。')
        }
      },
    },
  })
  const connection = service.connect((e) => events.push(e))
  t.after(async () => {
    connection.close()
    await service.close()
  })
  await connection.receive({ type: 'session.open' })
  await connection.receive({
    type: 'message.send',
    requestId: 'image',
    text: '请创作一张静谧的森林画面',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  const end = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(end.status, 'completed')
  assert.equal(f.runs(), 1)
  const m = end.snapshot.messages.at(-1)!
  assert.equal(m.content, '图片已生成。')
  assert.equal(m.timeline!.at(-1)!.kind, 'answer')
  assert.ok(!JSON.stringify(m).includes('must not be public'))
  assert.deepEqual(
    m.usage!.calls.map((c) => c.purpose),
    ['response', 'response', 'response', 'response', 'review', 'answer'],
  )
  assert.deepEqual(
    m.timeline!.map((x) => x.kind),
    ['analysis', 'tool', 'tool', 'analysis', 'analysis', 'answer'],
  )
  assert.ok(events.some((e) => e.type === 'timeline.delta'))
  assert.equal(
    m.toolCalls.some((c) => c.name.startsWith('workflow_')),
    false,
  )
})
test('planned reasoning and clarification skip business tools and review', async () => {
  for (const route of ['answer', 'clarify']) {
    const f = fixture()
    const events: ChatServerEvent[] = []
    let n = 0
    const service = new ChatService({
      registry: f.registry,
      workflow: { snapshot: async () => config },
      provider: {
        mode: 'openai',
        async next(input) {
          return n++ === 0
            ? call('workflow_plan', plan(route))
            : say(
                input,
                route === 'answer'
                  ? '已分析各项约束与取舍。'
                  : '请附加需要修改的图片。',
              )
        },
      },
    })
    const c = service.connect((e) => events.push(e))
    await c.receive({ type: 'session.open' })
    await c.receive({
      type: 'message.send',
      requestId: route,
      text:
        route === 'answer' ? '分析多个约束的取舍并给出建议' : '改一下它的背景',
      localDate: '2026-10-07',
    })
    await wait(() => events.some((e) => e.type === 'run.finished'))
    assert.equal(n, 2)
    assert.equal(f.runs(), 0)
    await service.close()
    c.close()
  }
})
test('adaptive entry streams simple answers and clarification in one call without a planning timeline', async (t) => {
  for (const [question, answer, streamed] of [
    ['1+1=多少', '1+1=2。', true],
    ['你好', '你好！', true],
    ['缺少附件，帮我改一下它的背景', '请上传需要修改的图片。', false],
  ] as const) {
    const f = fixture()
    const events: ChatServerEvent[] = []
    let calls = 0
    const service = new ChatService({
      registry: f.registry,
      workflow: { snapshot: async () => config },
      provider: {
        mode: 'openai',
        async next(input) {
          calls++
          assert.equal(input.toolChoice, 'auto')
          assert.deepEqual(
            input.tools.map((tool) => tool.name),
            ['workflow_plan'],
          )
          assert.ok(JSON.stringify(input.history).includes(question))
          await input.onUsage?.({
            inputTokens: 10,
            outputTokens: 2,
            responseId: 'direct',
          })
          if (streamed) {
            input.onDelta('', 'preliminary-message-id')
            input.onDelta(answer.slice(0, 1), 'first-message-id')
            input.onDelta(answer.slice(1), 'second-message-id')
          }
          return {
            calls: [],
            output: [{ role: 'assistant', content: answer }],
          }
        },
      },
    })
    const c = service.connect((event) => events.push(event))
    t.after(async () => {
      c.close()
      await service.close()
    })
    await c.receive({ type: 'session.open' })
    await c.receive({
      type: 'message.send',
      requestId: `direct-${events.length}-${streamed}`,
      text: question,
      localDate: '2026-10-08',
    })
    await wait(() => events.some((event) => event.type === 'run.finished'))
    const final = events.find(
      (event) => event.type === 'run.finished',
    ) as Extract<ChatServerEvent, { type: 'run.finished' }>
    const message = final.snapshot.messages.at(-1)!
    assert.equal(final.status, 'completed')
    assert.equal(calls, 1)
    assert.equal(f.runs(), 0)
    assert.equal(message.content, answer)
    assert.deepEqual(
      message.timeline?.map((item) => item.kind),
      ['answer'],
    )
    assert.deepEqual(
      message.usage?.calls.map((call) => call.purpose),
      ['response'],
    )
    assert.equal(message.toolCalls.length, 0)
    const storedHistory = [...service.sessions.all()][0]!.history
    assert.ok(JSON.stringify(storedHistory).includes(answer))
    assert.ok(!storedHistory.some((item) => item.type === 'function_call'))
    if (streamed) {
      assert.ok(events.some((event) => event.type === 'assistant.delta'))
    }
  }
})
test('adaptive entry cannot bypass the plan boundary with an unadvertised business call', async (t) => {
  const f = fixture()
  const events: ChatServerEvent[] = []
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next() {
        return call('images_generate', {})
      },
    },
  })
  const c = service.connect((event) => events.push(event))
  t.after(async () => {
    c.close()
    await service.close()
  })
  await c.receive({ type: 'session.open' })
  await c.receive({
    type: 'message.send',
    requestId: 'invalid-entry',
    text: '生成图片',
    localDate: '2026-10-08',
  })
  await wait(() => events.some((event) => event.type === 'run.finished'))
  const final = events.find(
    (event) => event.type === 'run.finished',
  ) as Extract<ChatServerEvent, { type: 'run.finished' }>
  assert.equal(f.runs(), 0)
  assert.equal(
    final.snapshot.messages.at(-1)!.error?.code,
    'WORKFLOW_DECISION_INVALID',
  )
})
test('legacy checkpoints resume their original forced analysis instead of re-entering adaptive dispatch', async () => {
  const f = fixture()
  const sessions = new MemorySessionRepository()
  const session = sessions.create()
  const events: ChatServerEvent[] = []
  session.send = (event) => events.push(event)
  const createdAt = new Date().toISOString()
  const messages: import('@t-box/shared').ChatMessage[] = [
    {
      id: 'legacy-user',
      role: 'user',
      content: '分析这个问题',
      createdAt,
      toolCalls: [],
    },
    {
      id: 'legacy-assistant',
      role: 'assistant',
      content: '',
      createdAt,
      toolCalls: [],
    },
  ]
  const checkpoint: RunCheckpoint = {
    version: 1,
    workflow: config,
    registryRevision: f.registry.revision,
    runId: 'legacy-run',
    requestId: 'legacy-request',
    localDate: '2026-10-08',
    applicationIds: [],
    bindings: [],
    assistantId: 'legacy-assistant',
    totalRounds: 0,
    delegations: 0,
    frames: [
      {
        agentId: 'assistant',
        history: [{ role: 'user', content: '分析这个问题' }],
        skills: [],
        rounds: 0,
        calls: [],
        content: '',
        done: false,
      },
    ],
    writes: [],
    session: { messages, requests: [], calls: [] },
  }
  let calls = 0
  const provider = {
    mode: 'openai' as const,
    async next(input: ProviderInput) {
      if (calls++ === 0) {
        assert.deepEqual(input.toolChoice, {
          type: 'function',
          name: 'workflow_plan',
        })
        return call('workflow_plan', plan('answer'))
      }
      assert.equal(input.toolChoice, 'none')
      return say(input, '已完成原任务。')
    },
  }
  await runConversation(
    {
      registry: f.registry,
      provider,
      workflow: { snapshot: async () => config },
    },
    sessions,
    {
      session,
      requestId: 'legacy-request',
      text: '',
      localDate: '2026-10-08',
      bindings: [],
      attachments: [],
      provider,
      applicationIds: [],
      resume: checkpoint,
    },
  )
  assert.equal(calls, 2)
  assert.equal(checkpoint.workflowEntry, undefined)
  assert.ok(
    events.some(
      (event) => event.type === 'run.finished' && event.status === 'completed',
    ),
  )
  sessions.clear()
})
test('a fabricated candidate cannot complete a plan whose required tool never succeeded', async (t) => {
  const f = fixture()
  const events: ChatServerEvent[] = []
  let n = 0
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next(input) {
        if (n++ === 0) {
          return call('workflow_plan', plan('execute', ['images_generate']))
        }
        if (input.tools[0]?.name === 'workflow_review') {
          return call('workflow_review', review(), `review-${n}`)
        }
        return say(input, '声称完成，但未调用工具。')
      },
    },
  })
  const c = service.connect((e) => events.push(e))
  t.after(async () => {
    c.close()
    await service.close()
  })
  await c.receive({ type: 'session.open' })
  await c.receive({
    type: 'message.send',
    requestId: 'fake',
    text: '生成图片',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  const end = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(end.status, 'failed')
  assert.equal(f.runs(), 0)
  assert.equal(
    end.snapshot.messages.at(-1)!.error?.code,
    'WORKFLOW_REVIEW_LIMIT',
  )
  assert.ok(
    !end.snapshot.messages.at(-1)!.timeline!.some((x) => x.kind === 'answer'),
  )
})
test('phase protocol rejects foreign capability names, malformed decisions and final tool calls', () => {
  assert.throws(() =>
    readPlan(
      call('workflow_plan', plan('execute', ['not_installed'])).calls,
      new Set(['images_generate']),
    ),
  )
  assert.throws(() => readPlan(call('wrong', plan()).calls, new Set()))
  assert.throws(() =>
    readReview(call('workflow_review', review('continue')).calls),
  )
  assert.throws(() =>
    parseWorkflowPrompts({ ...defaultWorkflowPrompts, analysis: '短' }),
  )
  assert.deepEqual(
    parseWorkflowPrompts(defaultWorkflowPrompts),
    defaultWorkflowPrompts,
  )
})
test('upstream errors are concise and never expose request bodies or secrets', () => {
  const e = {
    status: 400,
    code: 'unsupported_parameter',
    param: 'reasoning',
    message:
      'sk-secret Bearer secret https://secret.invalid request body user password',
  }
  assert.match(
    publicRunError(e).message,
    /400.*unsupported_parameter.*reasoning/,
  )
  assert.ok(!JSON.stringify(publicRunError(e)).includes('secret'))
  assert.match(publicRunError({ status: 401 }).message, /鉴权失败/)
  assert.match(publicRunError({ status: 429 }).message, /限流或额度/)
  assert.match(
    publicRunError({
      name: 'APIConnectionError',
      cause: { code: 'ECONNREFUSED' },
    }).message,
    /ECONNREFUSED/,
  )
  assert.equal(
    publicRunError(new Error('private body'), 'TIMEOUT').code,
    'RUN_TIMEOUT',
  )
})
test('OpenAI forced stage calls and incomplete responses preserve safe error cause and usage', async () => {
  let body: Record<string, unknown> = {}
  let usage = false
  const client = {
    responses: {
      create: async (sent: Record<string, unknown>) => {
        body = sent
        return (async function* () {
          yield {
            type: 'response.incomplete',
            response: {
              id: 'resp',
              incomplete_details: { reason: 'max_output_tokens' },
              usage: { input_tokens: 10, output_tokens: 2048 },
            },
          }
        })()
      },
    },
  } as unknown as OpenAI
  const provider = new OpenAIResponsesProvider(
    { apiKey: 'fixture', model: 'fixture', supportsReasoning: true },
    client,
  )
  await assert.rejects(
    () =>
      provider.next({
        history: [],
        tools: [],
        instructions: 'fixture',
        localDate: '2026-10-07',
        signal: new AbortController().signal,
        onDelta() {},
        onUsage: async () => {
          usage = true
        },
        toolChoice: { type: 'function', name: 'workflow_plan' },
        publicReasoning: false,
      }),
    /输出额度不足/,
  )
  assert.deepEqual(body.tool_choice, {
    type: 'function',
    name: 'workflow_plan',
  })
  assert.equal(body.reasoning, undefined)
  assert.equal(body.max_output_tokens, 32768)
  assert.equal(usage, true)
})
test('failed final response exposes the actual API status in run snapshot and timeline', async (t) => {
  const events: ChatServerEvent[] = []
  let n = 0
  const service = new ChatService({
    registry: fixture().registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next() {
        if (n++ === 0) {
          return call('workflow_plan', plan('answer'))
        }
        throw Object.assign(new Error('API credential secret'), {
          status: 401,
          code: 'invalid_api_key',
        })
      },
    },
  })
  const c = service.connect((e) => events.push(e))
  t.after(async () => {
    c.close()
    await service.close()
  })
  await c.receive({ type: 'session.open' })
  await c.receive({
    type: 'message.send',
    requestId: 'fail',
    text: '你好',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  const end = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.match(end.snapshot.messages.at(-1)!.content, /401.*invalid_api_key/)
  assert.match(end.snapshot.messages.at(-1)!.content, /会话回复生成失败/)
  assert.ok(!JSON.stringify(end.snapshot).includes('credential secret'))
})

test('a final stage cannot execute a business tool even if the model ignores tool_choice=none', async (t) => {
  const f = fixture()
  const events: ChatServerEvent[] = []
  let n = 0
  const service = new ChatService({
    registry: f.registry,
    workflow: { snapshot: async () => config },
    provider: {
      mode: 'openai',
      async next() {
        return n++ === 0
          ? call('workflow_plan', plan('answer'))
          : call('images_generate', {})
      },
    },
  })
  const c = service.connect((e) => events.push(e))
  t.after(async () => {
    c.close()
    await service.close()
  })
  await c.receive({ type: 'session.open' })
  await c.receive({
    type: 'message.send',
    requestId: 'final-tool',
    text: '你好',
    localDate: '2026-10-07',
  })
  await wait(() => events.some((e) => e.type === 'run.finished'))
  const end = events.find((e) => e.type === 'run.finished') as Extract<
    ChatServerEvent,
    { type: 'run.finished' }
  >
  assert.equal(f.runs(), 0)
  assert.equal(
    end.snapshot.messages.at(-1)!.error?.code,
    'WORKFLOW_UNEXPECTED_TOOL',
  )
})

test('gateway upstream failures are not mislabeled as parameter errors or exposed with model names', () => {
  const failure = publicRunError({
    status: 400,
    error: { message: 'upstream request failed for model private-model' },
  })
  assert.equal(failure.code, 'PROVIDER_UPSTREAM_FAILED')
  assert.equal(failure.message, '服务商上游模型请求失败（400）')
  assert.equal(failure.retryable, false)
  assert.ok(!JSON.stringify(failure).includes('private-model'))
  assert.equal(
    publicRunError({ status: 400 }).message,
    '模型服务拒绝请求（400）',
  )
})
