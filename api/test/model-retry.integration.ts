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
import { resolveContextPolicy } from '@t-box/shared'
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
const replacementModels = [randomUUID(), randomUUID()]
const routed: { key: string, purpose?: string, agentId?: string, logicalId?: string, retry?: number }[] = []
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
  let contextRequestCount = 0
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
  for (const id of replacementModels) {
    await source.query(
      'INSERT INTO ai_models(id,provider_id,model_id,name,enabled) VALUES(?,?,?,?,1)',
      [id, providerId, `fixture-${id}`, 'retry-failover-fixture'],
    )
  }
  const pool = new Map<string, ChatProvider>()
  for (const [index, id] of [modelId, ...replacementModels].entries()) {
    const key = `retry-fixture-${id}`
    const inner: ChatProvider = {
      ...raw,
      configurationKey: key,
      ...(index === 0
        ? {
            contextPolicy: { ...resolveContextPolicy(), tokenCounting: true, compaction: true, compactionMode: 'native' },
            async countInputTokens(input: ProviderInput) {
              return input.history.some((item) => item.type === 'compaction')
                ? 1000
                : input.history.some((item) => item.type === 'function_call_output' && input.history.some((call) => call.type === 'function_call' && call.call_id === item.call_id && call.name === 'time_timer_create')) ? 100000 : 1000
            },
            async compact(input: ProviderInput) {
              contextRequestCount++
              await input.onUsage?.({ responseId: randomUUID(), inputTokens: 100000, outputTokens: 1000 })
              return [{ type: 'compaction' as const, id: 'opaque-child', encrypted_content: 'private-native-memory' }, ...input.history.filter((item) => item.type !== 'reasoning')]
            },
          }
        : {}),
      async next(input) {
        routed.push({ key, purpose: input.execution?.purpose, agentId: input.execution?.agentId, logicalId: input.execution?.logicalRequestId, retry: input.execution?.retryIndex })
        assert.ok(input.history.every((item) => item.type !== 'reasoning' || item.id === `private-${id}`), 'No reasoning from another model is reused')
        if (index > 0) {
          assert.ok(input.history.every((item) => item.type !== 'compaction'), 'Opaque native memory is rebuilt before failover')
        }
        const turn = await raw.next(input)
        turn.output.unshift({ type: 'reasoning', id: `private-${id}`, summary: [], encrypted_content: `cipher-${id}` })
        return turn
      },
    }
    const metered = new MeteredChatProvider(inner, platform.billing, id, {
      inputPrice: String(index + 1),
      outputPrice: '2',
      imagePrice: '0',
    })
    Object.assign(metered, {
      modelIdentity: { modelId: id, providerId },
      failover: async (selection: { excludeModelIds: string[] }) => {
        const chosen = [...pool.values()].slice(index + 1).find((candidate) => !selection.excludeModelIds.includes(candidate.modelIdentity!.modelId))
        assert.ok(chosen, 'A compatible replacement is available')
        return chosen
      },
    })
    pool.set(key, metered)
  }
  const provider: ChatProvider = {
    mode: 'openai',
    async next() {
      throw new Error('Resolve the fixture pool first')
    },
    async forRun(options) {
      const resolved = options?.configurationKey ? pool.get(options.configurationKey) : [...pool.values()][0]
      assert.ok(resolved)
      return resolved
    },
  }
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
  assert.equal(new Set(routed.map((call) => call.key)).size, 3, 'Child and root failures each select a replacement model')
  for (const id of replacementModels) {
    const first = routed.findIndex((call) => call.key === `retry-fixture-${id}`)
    assert.ok(first > 0)
    assert.equal(routed[first]!.logicalId, routed[first - 1]!.logicalId, 'The logical request survives history migration and worker restart')
    assert.equal(routed[first]!.retry, 1)
  }
  assert.equal(final.configurationKey, `retry-fixture-${replacementModels[1]}`)
  assert.ok(message.timeline!.some((item) => item.kind === 'notice' && item.text.includes('切换可用模型重试')))
  assert.ok(cp.frames.at(-1)!.modelFailover?.pending, 'Pending failover survives worker restart')
  assert.deepEqual(cp.frames.at(-1)!.modelFailover!.modelIds, [modelId])
  assert.ok(cp.frames.at(-1)!.history.some((item) => item.type === 'compaction'), 'The interrupted specialist had native compressed history')
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
    requestCount + contextRequestCount - 2,
    'failed requests without usage are not fabricated as zero-token calls',
  )
  const usage = await source.query(
    'SELECT id,status FROM billing_usage WHERE user_id=?',
    [userId],
  )
  assert.equal(usage.length, requestCount + contextRequestCount)
  assert.equal(
    usage.filter((u: { status: string }) => u.status === 'review').length,
    2,
  )
  assert.equal(
    new Set(usage.map((u: { id: string }) => u.id)).size,
    requestCount + contextRequestCount,
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
  for (const id of [modelId, ...replacementModels]) {
    await source.query('DELETE FROM ai_models WHERE id=?', [id])
  }
  await source.query('DELETE FROM ai_providers WHERE id=?', [providerId])
  await source.destroy()
}
