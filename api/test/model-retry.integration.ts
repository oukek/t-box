import type { ChatServerEvent } from '@t-box/shared'
import type { RunCheckpoint } from '../src/agent/checkpoint.js'
import type {
  ChatProvider,
  ProviderInput,
  ProviderTurn,
} from '../src/chat/provider.js'
/** Real task journals, timers, archives and metering; fixture provider only, no paid model calls. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createBillRepository } from '@t-box/ledger-server/repository'
import OpenAI from 'openai'
import { defaultWorkflowPrompts } from '../src/agent-workflow/defaults.js'
import { MeteredChatProvider } from '../src/billing/provider.js'
import { ApplicationChatService } from '../src/bootstrap/chat.js'
import { createDataSource } from '../src/db/data-source.js'
import { ErrorCode } from '../src/error-codes.js'
import { PlatformService } from '../src/platform/service.js'
import { cleanupUsers } from './fixtures.js'
import { enableTestTariff } from './quota-fixtures.js'

const source = await createDataSource().initialize()
const platform = new PlatformService(source)
const providerId = randomUUID()
const modelId = randomUUID()
let userId: string | undefined
const services: ApplicationChatService[] = []
const call = (name: string, args: unknown): ProviderTurn => {
  const id = randomUUID()
  return {
    calls: [{ id, name, arguments: JSON.stringify(args) }],
    output: [
      {
        type: 'function_call',
        call_id: id,
        name,
        arguments: JSON.stringify(args),
      },
    ],
  }
}
const say = (input: ProviderInput, text: string): ProviderTurn => {
  input.onDelta(text)
  return { calls: [], output: [{ role: 'assistant', content: text }] }
}
const wait = async (check: () => boolean) => {
  const end = Date.now() + 15000
  while (!check()) {
    if (Date.now() > end) {
      throw new Error('Missing retry integration event')
    }
    await new Promise((r) => setTimeout(r, 5))
  }
}
try {
  await enableTestTariff(platform.billing)
  const login = await platform.identity.register(
    {
      username: `retry_${randomUUID().replaceAll('-', '')}`,
      password: 'test123',
    },
    'retry-fixture',
  )
  userId = login.user.id
  const actor = await platform.identity.authenticate(login.token)
  await platform.billing.wallet(userId)
  await source.query(
    'UPDATE ai_quota_accounts SET mode=\'record_only\' WHERE userId=?',
    [userId],
  )
  await source.query(
    'INSERT INTO ai_providers(id,name,base_url,key_cipher,enabled) VALUES(?,?,?,?,1)',
    [providerId, 'retry-fixture', 'http://localhost:1/v1', 'fixture'],
  )
  await source.query(
    'INSERT INTO ai_models(id,provider_id,model_id,name,enabled) VALUES(?,?,?,?,1)',
    [modelId, providerId, 'fixture', 'retry-fixture'],
  )
  let childFailed = false
  let rootFailed = false
  let requestCount = 0
  const operations = new Set<string>()
  const raw: ChatProvider = {
    mode: 'openai',
    configurationKey: 'retry-fixture',
    async next(input) {
      requestCount++
      assert.ok(!operations.has(input.execution!.operationId))
      operations.add(input.execution!.operationId)
      const child = input.execution?.agentId === 'time'
      const has = (name: string) =>
        input.history.some((i) => i.type === 'function_call' && i.name === name)
      const forced =
        typeof input.toolChoice === 'object' ? input.toolChoice.name : undefined
      if (child && has('time_timer_create') && !childFailed && !forced) {
        childFailed = true
        input.onDelta('截断的执行分析')
        throw ErrorCode.PROVIDER_FAILED()
      }
      if (!child && input.execution?.purpose === 'answer' && !rootFailed) {
        rootFailed = true
        input.onDelta('截断的旧回答')
        throw new OpenAI.APIError(503, {}, undefined, undefined)
      }
      await input.onUsage?.({
        responseId: randomUUID(),
        inputTokens: 12,
        outputTokens: 4,
      })
      if (forced === 'workflow_plan' || !has('workflow_plan')) {
        return call('workflow_plan', {
          route: 'execute',
          summary: child ? '创建倒计时。' : '委派时间助手处理。',
          steps: ['按请求执行'],
          requiredTools: child ? ['time_timer_create'] : [],
          verification: 'model',
        })
      }
      if (forced === 'workflow_review') {
        return call('workflow_review', {
          action: 'complete',
          summary: '已核对真实工具结果。',
          next: '',
        })
      }
      if (input.execution?.purpose === 'answer') {
        return say(input, '倒计时已创建，无需重复操作。')
      }
      if (child) {
        if (!has('time_timer_create')) {
          return call('time_timer_create', {
            label: '自动重试验证',
            durationSeconds: 120,
          })
        }
        return say(input, '倒计时回执已保存。')
      }
      if (!has('agent_delegate')) {
        return call('agent_delegate', {
          agentId: 'time',
          task: '创建120秒倒计时，名称自动重试验证',
        })
      }
      return say(input, '时间助手已完成处理。')
    },
  }
  const provider = new MeteredChatProvider(raw, platform.billing, modelId, {
    inputPrice: '0',
    outputPrice: '0',
    imagePrice: '0',
  })
  const realCheckpoint = platform.tasks.checkpoint.bind(platform.tasks)
  let crash = true
  platform.tasks.checkpoint = async (...args) => {
    await realCheckpoint(...args)
    const state = args[2] as RunCheckpoint
    if (
      crash &&
      Object.values(state.frames.at(-1)?.modelRequests || {}).some(
        (r) => r.status === 'waiting',
      )
    ) {
      crash = false
      throw new Error('Simulated worker exit after durable retry checkpoint')
    }
  }
  const start = async (conversationId?: string) => {
    const service = new ApplicationChatService({
      platform,
      bills: createBillRepository(source),
      provider,
      workflow: {
        snapshot: async () => ({
          revision: 1,
          prompts: defaultWorkflowPrompts,
          updatedAt: '2026-10-09T00:00:00Z',
        }),
      },
    })
    services.push(service)
    const events: ChatServerEvent[] = []
    const connection = service.connect((event) =>
      events.push(structuredClone(event)),
    )
    await connection.receive({
      type: 'session.open',
      authToken: login.token,
      clientCapabilities: [],
      ...(conversationId ? { conversationId } : {}),
    })
    return { service, events, connection }
  }
  const first = await start()
  await first.connection.receive({
    type: 'message.send',
    requestId: 'retry-timer',
    text: '创建120秒倒计时',
    localDate: '2026-10-09',
  })
  await wait(() => first.events.some((e) => e.type === 'run.finished'))
  const session = [...first.service.sessions.all()][0]!
  assert.equal(session.task!.status, 'paused')
  const taskId = session.task!.id
  const conversationId = session.conversationId!
  const cp = (await platform.tasks.get(actor, taskId))
    .checkpoint as RunCheckpoint
  assert.deepEqual(
    cp.frames.map((f) => f.agentId),
    ['assistant', 'time'],
  )
  const pending = Object.values(cp.frames.at(-1)!.modelRequests!).find(
    (r) => r.status === 'waiting',
  )!
  assert.equal(pending.retries, 1)
  assert.ok(pending.nextAttemptAt)
  assert.equal((await platform.time.list(userId)).timers.length, 1)
  first.connection.close()
  await first.service.close()
  const restarted = await start(conversationId)
  await restarted.connection.receive({ type: 'task.resume', taskId })
  await wait(() =>
    restarted.events.some(
      (e) =>
        e.type === 'timeline.update' &&
        e.item.kind === 'notice' &&
        e.item.label === '自动重试',
    ),
  )
  // Disconnect during the root answer retry. Backend must finish without the browser.
  restarted.connection.close()
  await wait(() => {
    const session = [...restarted.service.sessions.all()][0]!
    return !session.active && !session.finishing
  })
  const final = [...restarted.service.sessions.all()][0]!
  const message = final.messages.at(-1)!
  assert.equal(final.task!.status, 'completed')
  assert.equal(message.outcome, 'completed')
  assert.equal(
    (await platform.time.list(userId)).timers.length,
    1,
    'completed timer must not be repeated',
  )
  assert.equal(
    (await platform.tasks.get(actor, taskId)).tools.filter(
      (t) => t.name === 'time_timer_create',
    ).length,
    1,
  )
  const answers = message.timeline!.filter((i) => i.kind === 'answer')
  assert.equal(answers.length, 1)
  assert.equal(message.content, '倒计时已创建，无需重复操作。')
  assert.ok(
    restarted.events.some(
      (e) => e.type === 'assistant.replace' && e.content === '',
    ),
  )
  assert.equal(
    message.usage!.calls.length,
    requestCount - 2,
    'failed requests without usage are not fabricated as zero-token calls',
  )
  const usage = await source.query(
    'SELECT id,status FROM billing_usage WHERE user_id=?',
    [userId],
  )
  assert.equal(usage.length, requestCount)
  assert.equal(
    usage.filter((u: { status: string }) => u.status === 'review').length,
    2,
  )
  assert.equal(
    new Set(usage.map((u: { id: string }) => u.id)).size,
    requestCount,
  )
  console.log(
    'PASS: delegated timer executes once; retry checkpoint survives runtime restart; root stream resets; browser disconnection does not stop retry; per-attempt usage audit is unique.',
  )
} finally {
  for (const service of services) {
    await service.close()
  }
  if (userId) {
    await cleanupUsers(source, [userId])
  }
  await source.query('DELETE FROM ai_models WHERE id=?', [modelId])
  await source.query('DELETE FROM ai_providers WHERE id=?', [providerId])
  await source.destroy()
}
